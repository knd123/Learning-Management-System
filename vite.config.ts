import fs from 'node:fs';
import { createRequire } from 'node:module';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Serves the PowerPoint renderer as /slides/pptx-preview.js. The portal reads it and runs it inside a
 * sandboxed frame (src/components/FilePreview.tsx), so it is only downloaded when slides are shown.
 */
function slideRenderer(): Plugin {
  const file = createRequire(import.meta.url).resolve('pptx-preview/dist/pptx-preview.umd.js');
  return {
    name: 'slide-renderer',
    configureServer(server) {
      server.middlewares.use('/slides/pptx-preview.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        fs.createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'slides/pptx-preview.js', source: fs.readFileSync(file) });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), slideRenderer()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
});
