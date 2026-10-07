FROM node:22-bookworm

RUN apt-get update && \
    apt-get install -y g++ curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# Download the 2M dataset from GitHub Release
RUN mkdir -p data && \
    curl -L --fail --retry 3 \
    -o data/nse_2000000.csv \
    "https://github.com/Parthavi2/parallel-stock-market-analysis/releases/download/dataset-v1/nse_2000000.csv"

# Build C++ programs
RUN chmod +x scripts/build.sh && \
    ./scripts/build.sh

ENV PORT=10000

EXPOSE 10000

CMD ["npm", "start"]