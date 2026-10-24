import math

import numpy as np
import pandas as pd
from flask import Flask, jsonify, render_template, request

from train_model import ensure_model, current_season

app = Flask(__name__)
bundle = ensure_model()


# ---------------------------------------------------------------- helpers
class InputError(ValueError):
    pass


def number(data, key, label, lo=0, hi=10_000_000):
    try:
        value = float(data.get(key))
    except (TypeError, ValueError):
        raise InputError(f"{label} must be a number.")
    if not math.isfinite(value) or value != int(value):
        raise InputError(f"{label} must be a whole number.")
    if value < lo or value > hi:
        raise InputError(f"{label} must be between {lo} and {hi}.")
    return int(value)


def choice(data, key, label, allowed):
    value = str(data.get(key, "")).strip()
    if value not in allowed:
        raise InputError(f"Please choose a valid {label}.")
    return value


def read_stock(data):
    inv = number(data, "inventory", "Inventory level")
    sold = number(data, "sold", "Units sold")
    if sold > inv:
        raise InputError("Units sold cannot be more than the inventory level.")
    return inv, sold, inv - sold


def read_context(data):
    return (
        choice(data, "category", "category", bundle["categories"]),
        choice(data, "region", "region", bundle["regions"]),
        choice(data, "season", "seasonality", bundle["seasons"]),
    )


def forecast(inv, sold, remaining, category, region, season):
    """Predicted average daily demand, next 7 days (mean of 100 trees) + 10-90% range."""
    row = {
        "Inventory_Level": inv,
        "Units_Sold": sold,
        "Remaining": remaining,
        "ProductType": category,
        "Season": season,
        "Region": region,           # only used if the model was trained with it
    }
    X = pd.DataFrame([row])[bundle["features"]]
    model = bundle["model"]
    Xt = model.named_steps["prep"].transform(X)
    per_tree = np.array([t.predict(Xt)[0] for t in model.named_steps["rf"].estimators_])
    return (
        max(float(per_tree.mean()), 0.0),
        max(float(np.percentile(per_tree, 10)), 0.0),
        max(float(np.percentile(per_tree, 90)), 0.0),
    )


def stock_status(remaining, inventory):
    if remaining <= 0:
        return "out", "Out of stock"
    if inventory and remaining / inventory < 0.2:
        return "low", "Low stock"
    return "ok", "Healthy"


def cover_status(remaining, demand):
    if remaining <= 0:
        return "out", "Out of stock"
    days = remaining / demand if demand > 0 else 999
    if days < 3:
        return "out", "Stock-out risk"
    if days < 7:
        return "low", "Low cover"
    return "ok", "Healthy"


# ---------------------------------------------------------------- pages
@app.route("/")
def index():
    return render_template(
        "index.html",
        categories=bundle["categories"],
        regions=bundle["regions"],
        seasons=bundle["seasons"],
        default_season=current_season(),
    )


# ---------------------------------------------------------------- API
@app.post("/api/remaining")
def api_remaining():
    try:
        inv, sold, rem = read_stock(request.get_json(silent=True) or {})
    except InputError as e:
        return jsonify(error=str(e)), 400
    level, label = stock_status(rem, inv)
    return jsonify(
        remaining=rem,
        sell_through=round(sold / inv * 100, 1) if inv else 0,
        level=level,
        status=label,
        summary=f"{rem} units",
    )


@app.post("/api/predict")
def api_predict():
    data = request.get_json(silent=True) or {}
    try:
        inv, sold, rem = read_stock(data)
        cat, reg, sea = read_context(data)
    except InputError as e:
        return jsonify(error=str(e)), 400
    demand, low, high = forecast(inv, sold, rem, cat, reg, sea)
    level, label = cover_status(rem, demand)
    return jsonify(
        remaining=rem,
        demand=round(demand, 1),
        low=round(low, 1),
        high=round(high, 1),
        cover_days=round(rem / demand, 1) if demand > 0 else None,
        level=level,
        status=label,
        summary=f"{demand:.1f} units/day",
    )


@app.post("/api/order")
def api_order():
    data = request.get_json(silent=True) or {}
    try:
        inv, sold, rem = read_stock(data)
        cat, reg, sea = read_context(data)
        days = number(data, "days", "Days to cover", 1, 90)
        safety = number(data, "safety", "Safety stock", 0, 100)
    except InputError as e:
        return jsonify(error=str(e)), 400
    demand, low, high = forecast(inv, sold, rem, cat, reg, sea)
    needed = demand * days
    safety_units = needed * safety / 100
    target = needed + safety_units
    order = max(math.ceil(target - rem), 0)
    return jsonify(
        remaining=rem,
        demand=round(demand, 1),
        days=days,
        safety=safety,
        needed=round(needed),
        safety_units=round(safety_units),
        target=math.ceil(target),
        order=order,
        level="ok" if order == 0 else "low",
        status="No order needed" if order == 0 else "Order now",
        summary=f"Order {order} units",
    )


@app.errorhandler(404)
def not_found(_):
    return jsonify(error="Not found"), 404


if __name__ == "__main__":
    app.run(debug=True, use_reloader=False)
