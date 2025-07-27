import express from 'express';
import multer from 'multer';
import cors from 'cors';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

const upload = multer({ dest: 'uploads/' });

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
    // Clean up the uploaded file
    fs.unlinkSync(filePath);
    
    if (code === 0) {
      res.send(output);
    } else {
      res.status(500).send(`Parser error: ${errorOutput}`);
    }
  });
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
