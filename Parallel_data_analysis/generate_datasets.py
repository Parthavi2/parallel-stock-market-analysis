import os
import pandas as pd

# Target path for the double-sized dataset (2 Million records)
OUTPUT_FILE = "nse_2000000.csv"
TARGET_COUNT = 2000000

# Look for data source
DATA_SOURCES = [
    os.path.join("data", "nse_1000000.csv"),
    "nse_1000000.csv",
    os.path.join("data", "nse_data.csv")
]

def generate_double_dataset():
    source_file = None
    for path in DATA_SOURCES:
        if os.path.exists(path):
            source_file = path
            break

    if not source_file:
        print("Error: Could not locate a source dataset (nse_1000000.csv or data/nse_data.csv).")
        return

    print(f"Loading source dataset: '{source_file}'...")
    df = pd.read_csv(source_file)

    # Filter strictly for EQ records
    eq_df = df[df["SctySrs"] == "EQ"].reset_index(drop=True)
    num_eq = len(eq_df)

    print(f"Loaded {num_eq} EQ records.")

    # Calculate duplication required for 2,000,000 records
    repeats = (TARGET_COUNT // num_eq) + 1
    out_df = pd.concat([eq_df] * repeats, ignore_index=True).iloc[:TARGET_COUNT]

    # Save double-size dataset
    try:
        out_df.to_csv(OUTPUT_FILE, index=False)
        file_size_mb = os.path.getsize(OUTPUT_FILE) / (1024 * 1024)
        print("\n" + "=" * 60)
        print("SUCCESSFULLY GENERATED DOUBLE-SIZE DATASET")
        print("=" * 60)
        print(f"File Name : {OUTPUT_FILE}")
        print(f"EQ Records: {len(out_df):,}")
        print(f"Columns   : {len(out_df.columns)}")
        print(f"File Size : {file_size_mb:.2f} MB")
        print("=" * 60)
    except PermissionError:
        print(f"\nPermissionError: Cannot write to '{OUTPUT_FILE}'. Please close any program using it and re-run.")

if __name__ == "__main__":
    generate_double_dataset()