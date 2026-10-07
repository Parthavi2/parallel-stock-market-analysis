# Stock Market Data Analysis — Sequential vs OpenMP

**DAA + Parallel Programming** project. NSE equity (EQ series) records are analysed first by a
sequential C++ program and then by an OpenMP C++ program. A small dashboard runs the real programs and
visualises results, correctness, execution time, speedup, efficiency and scalability.

## 1. Project overview

```
Dataset → Algorithm → Sequential → OpenMP → Correctness → Time → Speedup → Efficiency → Scalability
```

| Path | Purpose |
|---|---|
| `src/sequential.cpp` | Sequential implementation (original algorithm) |
| `src/openmp.cpp` | OpenMP implementation (original algorithm) |
| `data/nse_1000000.csv`, `data/nse_2000000.csv` | Datasets (1M and 2M EQ records) |
| `generate_datasets.py` | Creates the 2M file by repeating the 1M EQ records |
| `scripts/build.sh` | Compiles both programs into `build/` |
| `scripts/benchmark.js` | Command-line benchmark (same code as the GUI button) |
| `backend/` | Tiny Node.js server (no npm packages) that runs the two programs in a controlled way |
| `frontend/` | The dashboard (plain HTML/CSS/JS, hand-written SVG charts, no build step) |
| `benchmark/results/benchmark.json` | Recorded benchmark (created when you run the benchmark) |
| `tests/` | Unit tests for the speedup / efficiency / correctness logic |

## 2. Existing algorithms

All of these are computed in **one loop** over the records (O(n) time; the records are held in an O(n) array):

* **Sum & Average** – Open price, Close price, Trading volume
* **Minimum / Maximum** – highest High price, lowest Low price
* **Counting** – number of EQ records, number with positive / negative daily return
* **Daily return (average)** – `(close − prevClose) / prevClose × 100`, averaged

CSV loading (filter `SctySrs == "EQ"`, parse 6 columns) happens before the loop and is **sequential in both programs**.

## 3. Sequential implementation
`src/sequential.cpp` — a plain `for` loop with running totals.

## 4. OpenMP implementation
`src/openmp.cpp` — the same loop with `#pragma omp parallel for` and
`reduction(+: …)`, `reduction(max: …)`, `reduction(min: …)`. The thread count is taken from `OMP_NUM_THREADS`.

## 5. Frontend
Pages: **Dashboard**, **Analysis** (run Sequential / Parallel, choose threads), **Performance** (benchmark + charts),
**Correctness**, **Algorithms**, **About Project**.
Everything shown comes from the real programs (live runs) or from `benchmark/results/benchmark.json` (recorded benchmark).

## 6. Install dependencies (macOS)

```bash
xcode-select --install          # Apple C++ compiler (skip if already installed)
brew install libomp node        # OpenMP runtime + Node.js (18 or newer)
```
No `npm install` is needed — the project has no npm dependencies.

## 7. Compile

```bash
cd Parallel_data_analysis       # the project root (folder containing src/ and data/)
chmod +x scripts/build.sh
./scripts/build.sh              # creates build/sequential and build/openmp
```
(The `.exe` files in the folder are old Windows builds and are not used.)

## 8–9. Start the backend + frontend (one command)

```bash
npm start
```
Open **http://localhost:5050**. The server only listens on your own computer.

## 10. Run an analysis
1. **Analysis** → pick a dataset.
2. Choose **Sequential** → **Run**.
3. Choose **OpenMP Parallel**, pick a thread count → **Run**.
   (or press **Run Sequential → Parallel & compare**)
4. Read the comparison table, speedup, efficiency and charts; open **Correctness**.

You can still run the programs directly, exactly as before:
```bash
./build/sequential                       # uses data/nse_2000000.csv
OMP_NUM_THREADS=4 ./build/openmp         # same dataset, 4 threads
./build/openmp data/nse_1000000.csv      # optional dataset argument (new)
```

## 11. Generate benchmark results
From the GUI: **Performance → Run benchmark**. Or from the terminal:
```bash
npm run benchmark -- --reps 5            # all datasets, all thread counts
npm run benchmark -- --reps 5 --datasets 1000000
```
For every dataset it runs 1 sequential + OpenMP at 1, 2, 4, 8 … threads (up to your logical core count),
repeats each configuration, stores the **median** and compares every parallel result with the sequential one.
Result file: `benchmark/results/benchmark.json`.

## 12. Speedup and efficiency
```
Speedup    = T_sequential / T_parallel
Efficiency = Speedup / Threads × 100
```
Both are reported for the **computation phase** (the OpenMP loop) and for the **total time** (CSV loading + computation).
Because loading is sequential, total-time speedup is limited by Amdahl's law — the dashboard shows this share explicitly.

**Correctness check:** counts, minimum and maximum must be *exactly* equal. Floating-point sums/averages are accepted
if the relative difference is ≤ 1e-9 (parallel reductions add numbers in a different order, so the last bits can differ).

## Optional: thread counts above your core count
The GUI offers 1, 2, 4, 8 … up to the number of logical cores. To allow more (e.g. to demonstrate over-subscription):
`MAX_THREADS=16 npm start`.

## Tests
```bash
npm test
```
