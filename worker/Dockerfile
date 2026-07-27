# CreatorFlow worker with ffmpeg bundled.
FROM node:20-slim

# ffmpeg brings ffprobe. Python powers free Edge narration and caption layout.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates python3 python3-pip \
  && pip3 install --no-cache-dir --break-system-packages edge-tts pillow \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
COPY *.mjs ./
COPY *.py ./
COPY assets ./assets

RUN mkdir -p /app/input /app/output
ENV CF_INPUT=/app/input CF_OUTPUT=/app/output

VOLUME ["/app/input", "/app/output"]

# Watch the input folder continuously. Override with a cron style run if you prefer:
#   docker run ... creatorflow-worker node watch.mjs --once
CMD ["node", "watch.mjs"]
