import { useState, useEffect } from 'react';
import { User } from 'firebase/auth';
import { initAuth, googleSignIn, logout, getAccessToken } from './auth';
import { FileText, LogOut, CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
}

export default function App() {
  const [needsAuth, setNeedsAuth] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    initAuth(
      (user, t) => {
        setUser(user);
        setToken(t);
        setNeedsAuth(false);
      },
      () => setNeedsAuth(true)
    );
  }, []);

  const handleLogin = async () => {
    setIsLoggingIn(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error('Login failed:', err);
    } finally {
      setIsLoggingIn(false);
    }
  };

  const loadRecentFiles = async () => {
    if (!token) return;
    setLoadingFiles(true);
    try {
      const q = encodeURIComponent("(mimeType='application/vnd.google-apps.document' or mimeType='text/plain') and trashed=false");
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&orderBy=modifiedTime desc&pageSize=10`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.files) {
        setFiles(data.files);
      }
    } catch (err) {
      console.error("Failed to load files:", err);
    } finally {
      setLoadingFiles(false);
    }
  };

  useEffect(() => {
    if (token) {
      loadRecentFiles();
    }
  }, [token]);

  const handleVerify = async (file: DriveFile) => {
    const confirmed = window.confirm(`Analyze "${file.name}" for ethical compliance?`);
    if (!confirmed) return;

    setSelectedFile(file);
    setVerifying(true);
    setVerificationResult(null);

    try {
      const currentToken = await getAccessToken();
      let fileContent = "";
      
      if (file.mimeType === 'application/vnd.google-apps.document') {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`, {
          headers: { Authorization: `Bearer ${currentToken}` }
        });
        fileContent = await res.text();
      } else {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
          headers: { Authorization: `Bearer ${currentToken}` }
        });
        fileContent = await res.text();
      }

      const verifyRes = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fileContent, filename: file.name })
      });
      
      const data = await verifyRes.json();
      if (data.success) {
        setVerificationResult(data.result);
      } else {
        console.error("Verification failed:", data.error);
        alert("Verification failed: " + data.error);
      }
    } catch (err) {
      console.error("Error during verification:", err);
      alert("Failed to analyze document.");
    } finally {
      setVerifying(false);
    }
  };

  if (needsAuth) {
    return (
      <div className="min-h-screen bg-neutral-900 text-neutral-100 flex flex-col items-center justify-center p-4 font-sans">
        <div className="max-w-md w-full bg-neutral-800 border border-neutral-700 rounded-2xl p-8 flex flex-col items-center text-center shadow-2xl">
          <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mb-6">
            <CheckCircle className="w-8 h-8 text-blue-400" />
          </div>
          <h1 className="text-2xl font-semibold mb-2">x402 Verification Node</h1>
          <p className="text-neutral-400 mb-8 text-sm">
            Ethical & Compliance Verification powered by Gemini. Sign in to analyze your documents.
          </p>
          
          <button 
            onClick={handleLogin}
            disabled={isLoggingIn}
            className="flex items-center gap-3 px-6 py-3 bg-white text-black rounded-lg font-medium hover:bg-neutral-100 transition-colors disabled:opacity-50"
          >
            <svg viewBox="0 0 48 48" className="w-5 h-5">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            <span>Sign in with Google</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-neutral-900 text-neutral-100 font-sans p-6">
      <div className="max-w-5xl mx-auto flex flex-col gap-8">
        
        <header className="flex items-center justify-between border-b border-neutral-800 pb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-500/10 rounded-xl flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-blue-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">x402 Verification Node</h1>
              <p className="text-sm text-neutral-400">Ethical & Compliance Analyzer</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-sm font-medium transition-colors">
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </header>

        <main className="grid md:grid-cols-2 gap-8">
          <section className="flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Recent Documents</h2>
              {loadingFiles && <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />}
            </div>
            
            <div className="bg-neutral-800/50 border border-neutral-800 rounded-xl overflow-hidden divide-y divide-neutral-800">
              {files.map(file => (
                <div key={file.id} className="flex items-center justify-between p-4 hover:bg-neutral-800 transition-colors">
                  <div className="flex items-center gap-3 overflow-hidden">
                    <FileText className="w-5 h-5 text-neutral-400 shrink-0" />
                    <span className="truncate text-sm">{file.name}</span>
                  </div>
                  <button 
                    onClick={() => handleVerify(file)}
                    className="ml-4 px-3 py-1.5 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-md text-xs font-semibold whitespace-nowrap transition-colors"
                  >
                    Analyze
                  </button>
                </div>
              ))}
              {files.length === 0 && !loadingFiles && (
                <div className="p-8 text-center text-sm text-neutral-500">
                  No documents or text files found in your Drive.
                </div>
              )}
            </div>
          </section>

          <section>
            <div className="bg-neutral-800 border border-neutral-700 rounded-xl p-6 h-full flex flex-col">
              <h2 className="text-lg font-medium mb-6">Analysis Report</h2>
              
              {!selectedFile && !verifying && !verificationResult && (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-neutral-500">
                  <FileText className="w-12 h-12 mb-3 opacity-20" />
                  <p className="text-sm max-w-[250px]">Select a document from the left to run ethical and compliance verification.</p>
                </div>
              )}

              {verifying && (
                <div className="flex-1 flex flex-col items-center justify-center text-center text-blue-400">
                  <Loader2 className="w-10 h-10 animate-spin mb-4" />
                  <p className="text-sm font-medium animate-pulse">Running node verification on "{selectedFile?.name}"...</p>
                </div>
              )}

              {verificationResult && !verifying && (
                <div className="flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  <div className="pb-4 border-b border-neutral-700">
                    <h3 className="text-sm text-neutral-400 mb-1">Target Document</h3>
                    <p className="font-medium truncate">{selectedFile?.name}</p>
                  </div>
                  
                  <div className="flex items-center gap-4">
                    {verificationResult.status === 'Passed' && <CheckCircle className="w-8 h-8 text-emerald-500" />}
                    {verificationResult.status === 'Flagged' && <AlertTriangle className="w-8 h-8 text-amber-500" />}
                    {verificationResult.status === 'Failed' && <XCircle className="w-8 h-8 text-red-500" />}
                    
                    <div>
                      <h3 className="text-sm text-neutral-400 mb-1">Compliance Status</h3>
                      <p className={`text-lg font-semibold ${
                        verificationResult.status === 'Passed' ? 'text-emerald-500' :
                        verificationResult.status === 'Flagged' ? 'text-amber-500' :
                        'text-red-500'
                      }`}>
                        {verificationResult.status.toUpperCase()}
                      </p>
                    </div>
                  </div>

                  <div className="bg-neutral-900/50 rounded-lg p-4">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 mb-2">Node Report</h3>
                    <p className="text-sm text-neutral-300 leading-relaxed whitespace-pre-wrap">
                      {verificationResult.report}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
        
        <footer className="mt-8 border-t border-neutral-800 pt-6 pb-2 text-xs text-neutral-500 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Entity Verified: RENMOLT ETHICAL SYSTEMS • SSM Reg. No: 202603057004 (TR0338241-U)</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="opacity-70">x402 Micropayment Base USDC:</span>
            <code className="font-mono bg-neutral-800 px-2 py-1 rounded text-neutral-400">0xF9C7c3022Bd8756E06172B37A6F9448a730638C9</code>
          </div>
        </footer>
      </div>
    </div>
  );
}
