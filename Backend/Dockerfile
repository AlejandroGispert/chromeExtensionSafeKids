FROM node:20-bullseye

# Install system dependencies: Python, pip, ffmpeg, yt-dlp
RUN apt-get update && \
    apt-get install -y python3 python3-pip ffmpeg && \
    pip3 install --upgrade pip yt-dlp && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package files and install Node dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the backend code
COPY . .

# Install Python dependencies
RUN pip3 install --no-cache-dir -r requirements.txt

# Ensure tmp directory exists
RUN mkdir -p /app/tmp

# Railway / Node will inject PORT; default to 4000
ENV PORT=4000

EXPOSE 4000

CMD ["node", "server.cjs"]


