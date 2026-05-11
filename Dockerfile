FROM ubuntu:24.04

# Install ffmpeg
RUN apt update && apt install -y ffmpeg curl xz-utils && apt clean

# Install nodejs and npm

# Set the Node.js version
ENV NODE_VERSION=24.15.0

# Download and extract Node.js
RUN curl -fsSL https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz | tar -xJ -C /usr/local --strip-components=1

# Create a directory for the app
WORKDIR /app

# Copy the app to the container
COPY . .

# Install the app
RUN npm install

# Run npm start
CMD ["npm", "start"]