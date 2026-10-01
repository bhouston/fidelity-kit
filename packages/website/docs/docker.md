---
title: Serve from Docker
---

A container can process and hash a suite once while building, then serve its viewer without repeating that work on startup. This example assumes your project has a `results/` directory and uses a published `fidelity-kit` package.

```dockerfile
FROM node:26-slim

RUN npm install -g fidelity-kit
COPY results /data
RUN fidelity-kit process /data && fidelity-kit hash /data

EXPOSE 8080
CMD ["fidelity-kit", "serve", "/data", "--host", "0.0.0.0", "--port", "8080", "--no-process"]
```

```sh
docker build -t my-fidelity-site .
docker run --rm -p 8080:8080 my-fidelity-site
```

Open `http://localhost:8080`. `hash` prepares versioned image URLs so repeat visits can reuse cached images. Rebuild the image when renders change. If results are instead mounted or modified at runtime, omit `--no-process` so `serve` refreshes comparisons at startup; `hash` is optional for that setup.

The image needs the suite's source images and metadata at `/data`. Do not copy only `index.json` and generated delta files: the viewer also serves the original images.
