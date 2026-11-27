# Stage 1: Compile the immutable F# 8 Pricing & Security Kernel (`credo-core`)
FROM mcr.microsoft.com/dotnet/sdk:8.0-alpine AS fsharp-builder
WORKDIR /build/fsharp-core
COPY fsharp-core/ ./
RUN ARCH=$(uname -m) && \
    if [ "$ARCH" = "aarch64" ]; then RID="linux-musl-arm64"; else RID="linux-musl-x64"; fi && \
    dotnet publish CredoOne.Core.fsproj -c Release -r "$RID" \
      --self-contained true \
      -p:PublishSingleFile=true \
      -p:IncludeNativeLibrariesForSelfExtract=true \
      -p:DebugType=None \
      -p:DebugSymbols=false \
      -o /out

# Stage 2: Production Credo Node.js + Compiled F# Kernel Runtime
FROM node:22-alpine

RUN apk add --no-cache curl ffmpeg python3 py3-pip libstdc++ libgcc tesseract-ocr tesseract-ocr-data-spa && \
    pip3 install --no-cache-dir --break-system-packages yt-dlp edge-tts

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=fsharp-builder /out/credo-core /app/bin/credo-core
RUN chmod +x /app/bin/credo-core

COPY fsharp-core ./fsharp-core
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=8080
ENV CREDO_FSHARP_BIN=/app/bin/credo-core

USER node
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/health || exit 1

CMD ["node", "src/index.js"]
