FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm install --production

COPY . .

# Create uploads dir
RUN mkdir -p /app/uploads

EXPOSE 5003

CMD ["npm", "start"]