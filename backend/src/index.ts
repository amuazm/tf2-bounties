import cors from 'cors';
import express from 'express';
import multer from 'multer';
import { DemoManager } from './demo/DemoManager';

const app = express();
const port = 3001;
const demoManager = new DemoManager();

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

app.post('/parse-demo', upload.single('demo'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  try {
    const output = await demoManager.parseDemo(req.file);
    const demoData = JSON.parse(output);
    demoManager.renderDemo(demoData, req.file.path);
    res.send(output);
  } catch (error) {
    res.status(500).send('Error processing demo');
  }
});

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
