import { exec, spawn } from "child_process"
import { log } from "console"
import ffmpeg from "ffmpeg-static"
import fs from "fs/promises"
import path from "path"
import { promisify } from "util"

const execPromise = promisify(exec)

interface DemoData {
    header: { nick: string }
    users: Record<string, { name: string }>
    deaths: Array<{ killer: number; victim: number; tick: number }>
}

export class DemoManager {
    private static readonly PARSER_PATH = "bin/parser/parse_demo.exe"
    private static readonly SVR_DIR = "bin/svr"
    private static readonly RENDER_DEMO_DIR = "bin/RenderDemo"

    public async parseDemo(file: Express.Multer.File): Promise<string> {
        const filePath = file.path

        return new Promise((resolve, reject) => {
            const process = spawn(DemoManager.PARSER_PATH, [filePath])

            let output = ''
            let errorOutput = ''

            process.stdout.on('data', (data) => {
                output += data.toString();
            })

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            })

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(output)
                } else {
                    reject(new Error(`Parser error: ${errorOutput}`))
                }
            })

            process.on('error', (error) => {
                reject(new Error(`Process error: ${error.message}`))
            })
        })
    }

    public async renderDemo(demoData: DemoData, filePath: string) {
        const recorderName = demoData.header.nick
        let playerId: number

        for (const userId in demoData.users) {
            if (demoData.users[userId].name === recorderName) {
                playerId = parseInt(userId)
                break
            }
        }

        const playerKills = demoData.deaths.filter((death: any) => death.killer === playerId && death.killer !== death.victim);
        log("kills: " + playerKills.length)

        if (playerKills.length < 1) {
            return
        }

        const groups: any[][] = []

        for (let i = 0; i < playerKills.length; i++) {
            // Get the current kill
            const startingKill = playerKills[i]
            let startingTick = startingKill.tick

            groups.push([startingKill])

            // Look at all kills ahead
            for (let j = i + 1; j < playerKills.length; j++) {
                const nextKill = playerKills[j]
                const nextTick = nextKill.tick

                // If next kill is less than 10s later, group it
                // 1 tick = 15ms
                if (nextTick - startingTick < 666) {
                    groups[groups.length - 1].push(nextKill)
                    startingTick = nextTick
                    // Skip the next kill
                    i++
                }
            }
        }

        log(groups)

        const demoName = path.basename(filePath, path.extname(filePath));
        let command = `start /wait cmd /c "` +
            `RenderDemo.exe ` +
            `-exepath "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf_win64.exe" ` +
            `-demo "${path.resolve(filePath)}" ` +
            `-launch "-width 1920 -height 1080" ` +
            `-out "movie" ` +
            `-cmd "cl_drawhud 0; tf_use_min_viewmodels 0" ` +
            `-sdrdir "${path.resolve(DemoManager.SVR_DIR)}" ` +
            `-loglevel debug ` +
            `-ranges ` +
            `"`;

        // Process groups sequentially
        for (let i = 0; i < groups.length; i++) {
            const startingTick = groups[i][0].tick - 333
            const endingTick = groups[i][groups[i].length - 1].tick + 333

            command += `${startingTick}:${endingTick}`

            // Is there another one?
            if (i + 1 !== groups.length) {
                command += ","
            }
        }

        try {
            const { stdout, stderr } = await execPromise(command, { cwd: DemoManager.RENDER_DEMO_DIR });
            console.log(`RenderDemo completed`);
            console.log(stdout);

            if (stderr) {
                console.log(stderr)
            }
        } catch (error) {
            console.error(`RenderDemo error:`, error);
        }

        console.log("All rendering tasks completed");

        this.processRenderedVideos(demoName);
    }

    public async processRenderedVideos(demoName: string): Promise<void> {
        const moviesDir = path.join(DemoManager.SVR_DIR, "movies");

        try {
            // Get all MOV files
            console.log("Finding MOV files...");
            const files = await fs.readdir(moviesDir);
            const movFiles = files.filter(file => file.endsWith('.mov') && file.startsWith('movie'));

            if (movFiles.length === 0) {
                console.log("No MOV files found.");
                return;
            }

            console.log(`Found ${movFiles.length} MOV files`); // Updated message

            // Convert all MOV files to MP4 in parallel with proper error handling
            console.log("Converting MOV files to MP4 in parallel...");
            const conversionPromises = movFiles.map(async (movFile) => {
                const mp4File = movFile.replace('.mov', '.mp4');
                const convertCommand = `"${ffmpeg}" -i "${path.join(moviesDir, movFile)}" -c:v libx264 -preset fast -crf 20 -c:a aac -b:a 192k "${path.join(moviesDir, mp4File)}"`;
                console.log(`Converting ${movFile} to ${mp4File}...`);

                try {
                    const result = await execPromise(convertCommand);
                    console.log(`✓ Completed: ${movFile} → ${mp4File}`);
                    return { success: true, file: mp4File };
                } catch (error) {
                    console.error(`✗ Failed: ${movFile}`, error);
                    return { success: false, file: mp4File };
                }
            });

            // Wait for all conversions to complete
            const results = await Promise.all(conversionPromises);

            // Check if all conversions succeeded
            const failures = results.filter(r => !r.success);
            if (failures.length > 0) {
                console.error(`${failures.length} conversions failed. Aborting.`);
                return;
            }

            console.log("All conversions completed successfully!");

            // Create file list in correct numeric order
            console.log("Creating file list...");
            const mp4Files = await fs.readdir(moviesDir);
            const movieMp4Files = mp4Files
                .filter(file => file.endsWith('.mp4') && file.startsWith('movie'))
                .sort((a, b) => {
                    // Extract number from filename for proper sorting
                    const numA = parseInt(a.match(/movie(\d+)\.mp4/)?.[1] || '0');
                    const numB = parseInt(b.match(/movie(\d+)\.mp4/)?.[1] || '0');
                    return numA - numB;
                });

            const fileListContent = movieMp4Files.map(file => `file '${file}'`).join('\n');
            const fileListPath = path.join(moviesDir, 'filelist.txt');
            await fs.writeFile(fileListPath, fileListContent);

            // Concatenate all MP4 files
            console.log("Concatenating videos...");
            const concatCommand = `"${ffmpeg}" -f concat -safe 0 -i "${fileListPath}" -c copy "${path.join(moviesDir, `${demoName}-combined.mp4`)}"`;
            await execPromise(concatCommand);

            // Cleanup temp files and MOV files
            console.log("Cleaning up files...");
            // Delete filelist.txt
            await fs.unlink(fileListPath);

            // Delete all MOV files
            console.log(`Deleting ${movFiles.length} original MOV files...`);
            for (const movFile of movFiles) {
                await fs.unlink(path.join(moviesDir, movFile));
            }

            // Delete all individual MP4 files (movie0.mp4, movie1.mp4, etc.)
            console.log(`Deleting ${movFiles.length} individual mp4 files...`);
            for (const mp4File of movieMp4Files) {
                await fs.unlink(path.join(moviesDir, mp4File));
            }

            console.log(`Video processing completed! Final video: bin/svr/movies/${demoName}-combined.mp4`);
        } catch (error) {
            console.error("Video processing error:", error);
        }
    }
}