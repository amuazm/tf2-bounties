import { useState } from 'react'
import './App.css'

interface FileInfo {
  name: string;
  size: number;
  file: File;
}

function App() {
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)
  const [output, setOutput] = useState<string | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFileSelect = async () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.dem'
    
    input.onchange = (e) => {
      const target = e.target as HTMLInputElement
      if (target.files && target.files[0]) {
        const file = target.files[0]
        setSelectedFile({ name: file.name, size: file.size, file })
        setError(null)
        setOutput(null)
      }
    }
    input.click()
  }

  const processDemo = async () => {
    if (!selectedFile) return
    
    setIsProcessing(true)
    setError(null)
    
    const formData = new FormData()
    formData.append('demo', selectedFile.file)
    
    try {
      const response = await fetch('http://localhost:3001/parse-demo', {
        method: 'POST',
        body: formData
      })
      const result = await response.text()
      setOutput(JSON.stringify(JSON.parse(result), null, 2))
    } catch (err) {
      setError('Failed to process demo')
    }
    setIsProcessing(false)
  }

  return (
    <div>
      <h1>TF2 Demo Parser</h1>
      <button onClick={handleFileSelect}>Select Demo File</button>
      
      {selectedFile && (
        <div>
          <p>File: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)</p>
          <button onClick={processDemo} disabled={isProcessing}>
            {isProcessing ? 'Processing...' : 'Parse Demo'}
          </button>
        </div>
      )}
      
      {error && <p style={{color: 'red'}}>{error}</p>}
      {output && <pre>{output}</pre>}
    </div>
  )
}

export default App
