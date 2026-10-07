FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y g++ && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

RUN chmod +x scripts/build.sh && \
    ./scripts/build.sh

ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]
