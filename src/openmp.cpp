#include <iostream>
#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <iomanip>
#include <chrono>
#include <limits>
#include <omp.h>

using namespace std;

struct StockRecord {
    double openPrice;
    double highPrice;
    double lowPrice;
    double closePrice;
    double previousClose;
    double volume;
};

double toDouble(const string& value) {

    if (value.empty()) {
        return 0.0;
    }

    try {
        return stod(value);
    }
    catch (...) {
        return 0.0;
    }
}

int main(int argc, char* argv[]) {

    // ---- Frontend integration (added) --------------------------------
    // Optional arguments:  <dataset path>   and/or   --json
    // With no arguments the program behaves exactly as before.
    string datasetPath = "data/nse_2000000.csv";
    bool jsonMode = false;
    for (int a = 1; a < argc; a++) {
        string arg = argv[a];
        if (arg == "--json") jsonMode = true;
        else datasetPath = arg;
    }
    // ------------------------------------------------------------------

    // =========================================================
    // DATA LOADING
    // =========================================================

    auto loadStart = chrono::high_resolution_clock::now();

    ifstream file(datasetPath);

    if (!file.is_open()) {
        if (jsonMode) {
            cout << "{\"error\":\"Could not open the CSV file\"}" << endl;
        } else {
            cout << "Error: Could not open the CSV file." << endl;
        }
        return 1;
    }

    string line;

    // Skip header
    getline(file, line);

    vector<StockRecord> records;

    while (getline(file, line)) {

        stringstream ss(line);
        string field;

        vector<string> columns;

        while (getline(ss, field, ',')) {
            columns.push_back(field);
        }

        // Make sure row has enough columns
        if (columns.size() < 26) {
            continue;
        }

        // Column 8 = SctySrs
        string series = columns[8];

        // Analyze only EQ records
        if (series != "EQ") {
            continue;
        }

        StockRecord record;

        // NSE UDiFF columns
        // 14 = Open Price
        // 15 = High Price
        // 16 = Low Price
        // 17 = Close Price
        // 19 = Previous Close
        // 25 = Total Trading Volume

        record.openPrice = toDouble(columns[14]);
        record.highPrice = toDouble(columns[15]);
        record.lowPrice = toDouble(columns[16]);
        record.closePrice = toDouble(columns[17]);
        record.previousClose = toDouble(columns[19]);
        record.volume = toDouble(columns[25]);

        records.push_back(record);
    }

    file.close();

    auto loadEnd = chrono::high_resolution_clock::now();

    chrono::duration<double> loadingTime =
        loadEnd - loadStart;


    // =========================================================
    // OPENMP PARALLEL COMPUTATION
    // =========================================================

    auto computeStart = chrono::high_resolution_clock::now();

    long long totalRecords = records.size();

    double totalOpen = 0.0;
    double totalClose = 0.0;
    double totalVolume = 0.0;

    double highestPrice = numeric_limits<double>::lowest();
    double lowestPrice = numeric_limits<double>::max();

    double totalReturn = 0.0;

    long long returnCount = 0;
    long long positiveRecords = 0;
    long long negativeRecords = 0;


    // Parallel processing
    #pragma omp parallel for \
        reduction(+:totalOpen,totalClose,totalVolume,totalReturn,returnCount,positiveRecords,negativeRecords) \
        reduction(max:highestPrice) \
        reduction(min:lowestPrice)

    for (long long i = 0; i < totalRecords; i++) {

        const StockRecord& record = records[i];

        totalOpen += record.openPrice;
        totalClose += record.closePrice;
        totalVolume += record.volume;

        if (record.highPrice > highestPrice) {
            highestPrice = record.highPrice;
        }

        if (record.lowPrice < lowestPrice) {
            lowestPrice = record.lowPrice;
        }

        if (record.previousClose > 0) {

            double dailyReturn =
                ((record.closePrice - record.previousClose)
                / record.previousClose) * 100.0;

            totalReturn += dailyReturn;

            returnCount++;

            if (dailyReturn > 0) {
                positiveRecords++;
            }
            else if (dailyReturn < 0) {
                negativeRecords++;
            }
        }
    }


    // =========================================================
    // CALCULATE FINAL STATISTICS
    // =========================================================

    double averageOpen = 0.0;
    double averageClose = 0.0;
    double averageVolume = 0.0;
    double averageReturn = 0.0;

    if (totalRecords > 0) {

        averageOpen = totalOpen / totalRecords;
        averageClose = totalClose / totalRecords;
        averageVolume = totalVolume / totalRecords;
    }

    if (returnCount > 0) {
        averageReturn = totalReturn / returnCount;
    }


    auto computeEnd = chrono::high_resolution_clock::now();

    chrono::duration<double> computationTime =
        computeEnd - computeStart;

    double totalTime =
        loadingTime.count() + computationTime.count();


    // =========================================================
    // OUTPUT
    // =========================================================

    // ---- Frontend integration (added): machine-readable output -------
    if (jsonMode) {
        cout << setprecision(17);
        cout << "{\"program\":\"openmp\""
             << ",\"threads\":" << omp_get_max_threads()
             << ",\"records\":" << totalRecords
             << ",\"averageOpen\":" << averageOpen
             << ",\"averageClose\":" << averageClose
             << ",\"highestPrice\":" << highestPrice
             << ",\"lowestPrice\":" << lowestPrice
             << ",\"totalVolume\":" << totalVolume
             << ",\"averageVolume\":" << averageVolume
             << ",\"positiveRecords\":" << positiveRecords
             << ",\"negativeRecords\":" << negativeRecords
             << ",\"returnCount\":" << returnCount
             << ",\"averageReturn\":" << averageReturn
             << ",\"loadingTime\":" << loadingTime.count()
             << ",\"computationTime\":" << computationTime.count()
             << ",\"totalTime\":" << totalTime
             << ",\"ompVersion\":" << _OPENMP
             << ",\"availableProcs\":" << omp_get_num_procs()
             << "}" << endl;
        return 0;
    }
    // ------------------------------------------------------------------

    cout << fixed << setprecision(4);

    cout << "\n========================================\n";
    cout << "   NSE STOCK MARKET ANALYSIS\n";
    cout << "   OPENMP PARALLEL VERSION\n";
    cout << "========================================\n\n";

    cout << "Total EQ Records       : "
         << totalRecords << endl;


    cout << "\n--- Price Statistics ---\n";

    cout << "Average Open Price     : "
         << averageOpen << endl;

    cout << "Average Close Price    : "
         << averageClose << endl;

    cout << "Highest Price          : "
         << highestPrice << endl;

    cout << "Lowest Price           : "
         << lowestPrice << endl;


    cout << "\n--- Volume Statistics ---\n";

    cout << "Total Trading Volume   : "
         << totalVolume << endl;

    cout << "Average Trading Volume : "
         << averageVolume << endl;


    cout << "\n--- Market Trend ---\n";

    cout << "Positive Records       : "
         << positiveRecords << endl;

    cout << "Negative Records       : "
         << negativeRecords << endl;

    cout << "Average Daily Return   : "
         << averageReturn << "%" << endl;


    cout << "\n--- Parallel Performance ---\n";

    cout << "Number of Threads      : "
         << omp_get_max_threads() << endl;

    cout << "Data Loading Time      : "
         << loadingTime.count()
         << " seconds" << endl;

    cout << "Computation Time       : "
         << computationTime.count()
         << " seconds" << endl;

    cout << "Total Execution Time   : "
         << totalTime
         << " seconds" << endl;


    cout << "\n========================================\n";

    return 0;
}