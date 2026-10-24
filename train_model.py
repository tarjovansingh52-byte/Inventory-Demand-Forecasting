import os
import warnings

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_absolute_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

warnings.filterwarnings("ignore")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "Electronics_Dataset.xlsx")
MODEL_PATH = os.path.join(BASE_DIR, "model.pkl")

SEASONS = ["Winter", "Summer", "Monsoon", "Festive"]
HORIZON_DAYS = 7
DEFAULT_REGIONS = ["North", "South", "East", "West", "Central"]


def season_of(month: int) -> str:
    """Month number -> season name (India based)."""
    if month in (12, 1, 2):
        return "Winter"
    if month in (3, 4, 5, 6):
        return "Summer"
    if month in (7, 8, 9):
        return "Monsoon"
    return "Festive"          # Oct, Nov


def current_season() -> str:
    return season_of(pd.Timestamp.today().month)


def load_data(path: str = DATA_PATH) -> pd.DataFrame:
    df = pd.read_excel(path)
    df["Date"] = pd.to_datetime(df["Date"])
    # Category dropdown = the product type (Mobile, Laptop, ...) because the
    # "Category" column in the file only ever says "Electronics".
    df["ProductType"] = df["Subcategory"].astype(str).str.strip()
    df["Season"] = df["Date"].dt.month.map(season_of)
    return df


def build_training_table(df: pd.DataFrame):
    df = df.sort_values(["Product_ID", "Date"]).copy()
    df["Remaining"] = df["Inventory_Level"] - df["Units_Sold"]
    # target = AVERAGE daily demand of the same product over the NEXT 7 days.
    # (A single day is mostly random noise; a 7-day average is what stock
    #  planning needs and what the model can predict accurately.)
    df["Next_Demand"] = df.groupby("Product_ID")["Demand"].transform(
        lambda s: s[::-1].rolling(HORIZON_DAYS).mean()[::-1].shift(-1)
    )
    df = df.dropna(subset=["Next_Demand"])

    num = ["Inventory_Level", "Units_Sold", "Remaining"]
    cat = ["ProductType", "Season"]
    # If you later add a "Region" column to the Excel file it is used automatically.
    if "Region" in df.columns:
        cat.append("Region")
    return df, num, cat


def train(verbose: bool = True) -> dict:
    df, num, cat = build_training_table(load_data())

    def make_model():
        prep = ColumnTransformer(
            [("cat", OneHotEncoder(handle_unknown="ignore", sparse_output=False), cat)],
            remainder="passthrough",
            sparse_threshold=0,
        )
        rf = RandomForestRegressor(
            n_estimators=100, min_samples_leaf=5, n_jobs=-1, random_state=42
        )
        return Pipeline([("prep", prep), ("rf", rf)])

    features = num + cat

    # ---- honest check: train on the past, test on the last 90 days ----
    cutoff = df["Date"].max() - pd.Timedelta(days=90)
    # gap of 7 days so no training target overlaps the test period
    tr = df[df["Date"] <= cutoff - pd.Timedelta(days=HORIZON_DAYS)]
    te = df[df["Date"] > cutoff]
    check = make_model().fit(tr[features], tr["Next_Demand"])
    pred = check.predict(te[features])
    metrics = {
        "mae": round(float(mean_absolute_error(te["Next_Demand"], pred)), 2),
        "r2": round(float(r2_score(te["Next_Demand"], pred)), 3),
        "baseline_mae": round(float(mean_absolute_error(te["Next_Demand"], te["Units_Sold"])), 2),
        "rows": int(len(df)),
    }
    if verbose:
        print(f"Rows used           : {metrics['rows']}")
        print(f"Test MAE (units/day): {metrics['mae']}   (copy-today baseline: {metrics['baseline_mae']})")
        print(f"Test R2             : {metrics['r2']}")

    # ---- final model on all data ----
    model = make_model().fit(df[features], df["Next_Demand"])

    regions = sorted(df["Region"].unique()) if "Region" in df.columns else DEFAULT_REGIONS
    bundle = {
        "model": model,
        "features": features,
        "categories": sorted(df["ProductType"].unique()),
        "regions": list(regions),
        "region_in_model": "Region" in df.columns,
        "seasons": SEASONS,
        "metrics": metrics,
    }
    joblib.dump(bundle, MODEL_PATH, compress=3)
    if verbose:
        print(f"Saved model -> {MODEL_PATH}")
    return bundle


def ensure_model() -> dict:
    """Load model.pkl, training it first if it does not exist (or is unreadable)."""
    if os.path.exists(MODEL_PATH):
        try:
            return joblib.load(MODEL_PATH)
        except Exception:
            pass
    return train()


if __name__ == "__main__":
    train()
