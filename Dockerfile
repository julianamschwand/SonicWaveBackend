FROM node:18-slim
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
ENV DOCKER=true
EXPOSE 3000
CMD ["node", "app.js"]