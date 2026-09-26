FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY server.mjs ./
ENV PORT=8790
EXPOSE 8790
CMD ["node", "server.mjs"]
