import { exec, spawn } from "child_process"
import { promisify } from "util"
import { log } from "console"
import path from "path"

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

        if (playerKills.length > 0) {
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

            // Process groups sequentially
            for (let i = 0; i < groups.length; i++) {
                const startingTick = groups[i][0].tick - 333
                const endingTick = groups[i][groups[i].length - 1].tick + 333
                log("group " + i + ": ")
                log("starting tick: " + startingTick)
                log("ending tick: " + endingTick)

                const demoName = path.basename(filePath, path.extname(filePath));
                const command = `start /wait cmd /c "` +
                    `RenderDemo.exe ` +
                    `-exepath "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf_win64.exe" ` +
                    `-demo "${path.resolve(filePath)}" ` +
                    `-start ${startingTick} -end ${endingTick} ` +
                    `-out "${demoName}-${startingTick}-${endingTick}.mov" ` +
                    `-launch "-width 1920 -height 1080" ` +
                    `-cmd "spec_player ${recorderName}; spec_mode 5; cl_drawhud 0; tf_use_min_viewmodels 0" ` +
                    `-sdrdir "${path.resolve(DemoManager.SVR_DIR)}" ` +
                    `-loglevel debug` +
                    `"`;

                try {
                    console.log(`Starting render for group ${i}...`);
                    const { stdout, stderr } = await execPromise(command, { cwd: DemoManager.RENDER_DEMO_DIR });
                    
                    console.log(`RenderDemo completed for group ${i}`);
                    console.log(stdout);
                    if (stderr) console.log(stderr);
                } catch (error) {
                    console.error(`RenderDemo error for group ${i}:`, error);
                    // Decide whether to continue or break on error
                    // throw error; // Uncomment to stop on first error
                }
            }
            
            console.log("All rendering tasks completed");
        }
    }
}