import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import path from 'path';
import { initDatabase } from './server/db.ts';
import { createApiRouter } from './server/routes.ts';

dotenv.config();

async function startServer() {
  initDatabase();

  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';

  app.set('trust proxy', 1);
  app.use(cookieParser());
  app.use(express.json({ limit: '4mb' }));

  app.use('/api', createApiRouter());

  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: false,
        watch: null,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir, { index: false }));
    app.get('*', (_req, res) => {
      const indexHtml = path.join(distDir, 'index.html');
      if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
      } else {
        res.status(404).send('Build not found');
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gestor de Visitas MIPERSA escuchando en puerto ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Error fatal al iniciar servidor MIPERSA:', err);
  process.exit(1);
});
