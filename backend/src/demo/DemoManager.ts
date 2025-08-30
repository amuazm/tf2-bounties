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
            // 333 - 5 seconds
            // 133 - 2 seconds
            const startingTick = groups[i][0].tick - 333
            const endingTick = groups[i][groups[i].length - 1].tick + 133

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
            console.log("Finding MOV files...");
            const files = await fs.readdir(moviesDir);
            const movFiles = files.filter(file => file.endsWith('.mov') && file.startsWith('movie'));

            if (movFiles.length === 0) {
                console.log("No MOV files found.");
                return;
            }

            console.log(`Found ${movFiles.length} MOV files`);

            // Convert all MOV files to MP4 with DaVinci Resolve compatibility
            console.log("Converting MOV files to DaVinci Resolve-compatible MP4...");
            const conversionPromises = movFiles.map(async (movFile) => {
                const mp4File = movFile.replace('.mov', '.mp4');

                // Enhanced command for DaVinci Resolve compatibility
                const convertCommand = `"${ffmpeg}" -i "${path.join(moviesDir, movFile)}" ` +
                    `-c:v libx264 ` +                    // Use H.264 codec
                    `-profile:v high ` +                  // High profile for better compatibility
                    `-level 4.1 ` +                      // Level 4.1 for broad compatibility
                    `-pix_fmt yuv420p ` +                 // Force 8-bit 4:2:0 (most compatible)
                    `-preset fast ` +                     // Fast encoding
                    `-crf 18 ` +                          // High quality (lower = better)
                    `-movflags +faststart ` +             // Optimize for streaming/editing
                    `-c:a aac ` +                         // AAC audio codec
                    `-b:a 192k ` +                        // Audio bitrate
                    `-ar 48000 ` +                        // 48kHz sample rate (standard for video)
                    `"${path.join(moviesDir, mp4File)}"`;

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

            const results = await Promise.all(conversionPromises);
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
                    const numA = parseInt(a.match(/movie(\d+)\.mp4/)?.[1] || '0');
                    const numB = parseInt(b.match(/movie(\d+)\.mp4/)?.[1] || '0');
                    return numA - numB;
                });

            const fileListContent = movieMp4Files.map(file => `file '${file}'`).join('\n');
            const fileListPath = path.join(moviesDir, 'filelist.txt');
            await fs.writeFile(fileListPath, fileListContent);

            // Concatenate with re-encoding to ensure consistency
            console.log("Concatenating videos with consistent encoding...");
            const concatCommand = `"${ffmpeg}" -f concat -safe 0 -i "${fileListPath}" ` +
                `-c:v libx264 ` +                     // Re-encode video for consistency
                `-profile:v high ` +
                `-level 4.1 ` +
                `-pix_fmt yuv420p ` +                 // Ensure 8-bit output
                `-preset fast ` +
                `-crf 18 ` +
                `-movflags +faststart ` +
                `-c:a aac ` +
                `-b:a 192k ` +
                `-ar 48000 ` +
                `"${path.join(moviesDir, `${demoName}-combined.mp4`)}"`;

            await execPromise(concatCommand);

            // Cleanup
            console.log("Cleaning up files...");
            await fs.unlink(fileListPath);

            for (const movFile of movFiles) {
                await fs.unlink(path.join(moviesDir, movFile));
            }

            for (const mp4File of movieMp4Files) {
                await fs.unlink(path.join(moviesDir, mp4File));
            }

            console.log(`Video processing completed! Final video: bin/svr/movies/${demoName}-combined.mp4`);

        } catch (error) {
            console.error("Video processing error:", error);
        }
    }
}