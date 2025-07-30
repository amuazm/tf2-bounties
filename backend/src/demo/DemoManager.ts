import { exec, spawn } from "child_process";
import path from "path";

interface DemoData {
    header: { nick: string };
    users: Record<string, { name: string }>;
    deaths: Array<{ killer: number; victim: number; tick: number }>;
}

export class DemoManager {
    private static readonly PARSER_PATH = "bin/parser/parse_demo.exe";
    private static readonly SVR_DIR = "bin/svr";
    private static readonly RENDER_DEMO_DIR = "bin/RenderDemo";

    public async parseDemo(file: Express.Multer.File): Promise<string> {
        const filePath = file.path;

        return new Promise((resolve, reject) => {
            const process = spawn(DemoManager.PARSER_PATH, [filePath]);

            let output = '';
            let errorOutput = '';

            process.stdout.on('data', (data) => {
                output += data.toString();
            });

            process.stderr.on('data', (data) => {
                errorOutput += data.toString();
            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve(output);
                } else {
                    reject(new Error(`Parser error: ${errorOutput}`));
                }
            });

            process.on('error', (error) => {
                reject(new Error(`Process error: ${error.message}`));
            });
        });
    }

    public renderDemo(demoData: DemoData, filePath: string) {
        const recorderName = demoData.header.nick;
        let playerId: number;

        for (const userId in demoData.users) {
            if (demoData.users[userId].name === recorderName) {
                playerId = parseInt(userId);
                break;
            }
        }

        const playerKills = demoData.deaths.filter((death: any) => death.killer === playerId && death.killer !== death.victim);
        console.log("kills: " + playerKills.length)

        if (playerKills.length > 0) {
            const tick = playerKills[0].tick;
            const startTick = tick - 500;
            const endTick = tick + 500;
            const command = `start /wait cmd /c "` +
                `RenderDemo.exe ` +
                `-exepath "C:\\Program Files (x86)\\Steam\\steamapps\\common\\Team Fortress 2\\tf_win64.exe" ` +
                `-demo "${path.resolve(filePath)}" ` +
                `-start ${startTick} -end ${endTick} ` +
                `-out "test.mov" ` +
                `-launch "-width 1920 -height 1080" ` +
                `-cmd "spec_player ${recorderName}; spec_mode 5; cl_drawhud 0" ` +
                `-sdrdir "${path.resolve(DemoManager.SVR_DIR)}" ` +
                `-loglevel debug` +
                `"`;

            exec(command, { cwd: DemoManager.RENDER_DEMO_DIR }, (error, stdout, stderr) => {
                console.log(`RenderDemo completed`);
                console.log(stdout);
                console.log(stderr);

                if (error) {
                    console.log(`RenderDemo error: ${error}`);
                }
            });
        }
    }
}