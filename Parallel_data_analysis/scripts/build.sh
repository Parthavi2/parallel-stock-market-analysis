#!/usr/bin/env bash
# Builds the EXISTING sequential and OpenMP programs into ./build/
# Works on macOS (Apple clang + Homebrew libomp, or Homebrew gcc) and Linux (g++).
set -e
cd "$(dirname "$0")/.."
mkdir -p build

echo "== Building sequential =="
c++ -O2 -std=c++17 src/sequential.cpp -o build/sequential
echo "   -> build/sequential"

echo "== Building OpenMP parallel =="
OMP_OK=0
if [[ "$(uname)" == "Darwin" ]]; then
  # 1) Homebrew GCC (g++-NN) supports -fopenmp directly
  GXX="$(ls /opt/homebrew/bin/g++-[0-9]* /usr/local/bin/g++-[0-9]* 2>/dev/null | sort -V | tail -1 || true)"
  # 2) Apple clang needs Homebrew libomp
  LIBOMP="$(brew --prefix libomp 2>/dev/null || true)"
  if [[ -n "$LIBOMP" && -d "$LIBOMP/include" ]]; then
    clang++ -O2 -std=c++17 -Xpreprocessor -fopenmp -I"$LIBOMP/include" -L"$LIBOMP/lib" -lomp \
      src/openmp.cpp -o build/openmp && OMP_OK=1 && echo "   (clang++ + libomp)"
  elif [[ -n "$GXX" ]]; then
    "$GXX" -O2 -std=c++17 -fopenmp src/openmp.cpp -o build/openmp && OMP_OK=1 && echo "   ($GXX)"
  fi
  if [[ $OMP_OK -eq 0 ]]; then
    echo "ERROR: no OpenMP compiler found. Run:  brew install libomp   then re-run this script."
    exit 1
  fi
else
  c++ -O2 -std=c++17 -fopenmp src/openmp.cpp -o build/openmp
fi
echo "   -> build/openmp"
echo "Done."
