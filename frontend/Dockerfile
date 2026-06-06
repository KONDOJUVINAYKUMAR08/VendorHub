FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 5173

# Use VITE_GATEWAY_URL env at runtime for dev server
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]