# Use Node.js as the base
FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies
RUN npm install

# Copy the entire project
COPY . .

# Expose the port Hugging Face expects
EXPOSE 7860

# Set the port environment variable for the app
ENV PORT=7860

# Start the server
CMD ["node", "server/index.js"]
