import { exec, spawn } from 'child_process';
import cors from 'cors';
import express from 'express';
import multer from 'multer';
import path from 'path';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.diskStorage({
    destination: 'uploads/',
    filename: (req, file, cb) => {
      cb(null, file.originalname);
    }
  })
});

app.post('/parse-demo', upload.single('demo'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  const filePath = req.file.path;
  const parserPath = 'bin/parser/parse_demo.exe';

  const process = spawn(parserPath, [filePath]);

  let output = '';
  let errorOutput = '';

  process.stdout.on('data', (data) => {
    output += data.toString();
  });

  process.stderr.on('data', (data) => {
    errorOutput += data.toString();
  });

  process.on('close', (code) => {
    try {
      if (code === 0) {
        const demoData = JSON.parse(output);
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
            `-cmd "spec_player ${recorderName}; spec_mode 5" ` +
            `-sdrdir "${path.resolve("bin/svr")}" ` +
            `-loglevel debug` +
            `"`;

          exec(command, { cwd: "bin/RenderDemo" }, (error, stdout, stderr) => {
            console.log(`RenderDemo completed`);
            if (error) console.log(`RenderDemo error: ${error}`);
          });
        }

        res.send(output);
      } else {
        res.status(500).send(`Parser error: ${errorOutput}`);
      }
    } catch (error) {
      res.status(500).send('Error processing demo');
    } finally {
      // Clean up the uploaded file
      // fs.unlinkSync(filePath);
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
