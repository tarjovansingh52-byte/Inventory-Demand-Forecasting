/* script.js - tabs, validation, calls the Flask API and shows the result */
(function () {
  "use strict";

  var TABS = {
    remaining: {
      title: "Remaining inventory",
      hint: "Enter stock and sales to see how many units are left.",
      button: "Calculate remaining", btnIcon: "calc", icon: "box",
      url: "/api/remaining", kind: "rem"
    },
    demand: {
      title: "Demand prediction",
      hint: "Predicts the average daily demand for the next 7 days using the Random Forest model.",
      button: "Predict demand", btnIcon: "chart", icon: "chart",
      url: "/api/predict", kind: "dem"
    },
    order: {
      title: "Order quantity",
      hint: "Works out how many units to order to cover the chosen days plus safety stock.",
      button: "Calculate order", btnIcon: "cart", icon: "cart",
      url: "/api/order", kind: "ord"
    }
  };

  var SVGNS = "http://www.w3.org/2000/svg";
  var $ = function (id) { return document.getElementById(id); };
  var el = {
    form: $("form"), title: $("formTitle"), hint: $("formHint"), formIcon: $("formIcon"), go: $("go"),
    inv: $("inv"), sold: $("sold"), rem: $("rem"),
    category: $("category"), region: $("region"), season: $("season"),
    days: $("days"), safety: $("safety"),
    error: $("error"), result: $("result"), log: $("log"), panel: $("panel"), clear: $("clearLog")
  };
  var tabButtons = Array.prototype.slice.call(document.querySelectorAll("[role=tab]"));
  var current = "remaining";
  var busy = false;
  var history = [];

  /* ---------- small helpers ---------- */
  function make(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function icon(name, cls) {
    var s = document.createElementNS(SVGNS, "svg");
    s.setAttribute("class", "ico" + (cls ? " " + cls : ""));
    s.setAttribute("viewBox", "0 0 24 24");
    s.setAttribute("aria-hidden", "true");
    var u = document.createElementNS(SVGNS, "use");
    u.setAttribute("href", "#i-" + name);
    s.appendChild(u);
    return s;
  }
  function fmt(n) { return Number(n).toLocaleString("en-IN"); }
  function intOrNaN(v) { return v === "" ? NaN : Number(v); }

  function setGo(label) {
    el.go.replaceChildren(icon(TABS[current].btnIcon), make("span", "", label), icon("arrow", "arrow"));
  }

  /* ---------- tabs ---------- */
  function setTab(name, focus) {
    current = name;
    document.body.setAttribute("data-tab", name);
    tabButtons.forEach(function (b) {
      var on = b.getAttribute("data-tab") === name;
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      if (on) {
        el.panel.setAttribute("aria-labelledby", b.id);
        if (focus) b.focus();
      }
    });
    el.title.textContent = TABS[name].title;
    el.hint.textContent = TABS[name].hint;
    el.formIcon.setAttribute("href", "#i-" + TABS[name].icon);
    setGo(TABS[name].button);
    el.error.textContent = "";
    showEmpty();
  }

  tabButtons.forEach(function (b, i) {
    b.addEventListener("click", function () { setTab(b.getAttribute("data-tab")); });
    b.addEventListener("keydown", function (e) {
      var j = null;
      if (e.key === "ArrowRight") j = (i + 1) % tabButtons.length;
      if (e.key === "ArrowLeft") j = (i - 1 + tabButtons.length) % tabButtons.length;
      if (e.key === "Home") j = 0;
      if (e.key === "End") j = tabButtons.length - 1;
      if (j !== null) {
        e.preventDefault();
        setTab(tabButtons[j].getAttribute("data-tab"), true);
      }
    });
  });

  /* ---------- live remaining ---------- */
  function updateRemaining() {
    var inv = intOrNaN(el.inv.value), sold = intOrNaN(el.sold.value);
    el.rem.value = (isFinite(inv) && isFinite(sold)) ? fmt(inv - sold) : "";
  }
  el.inv.addEventListener("input", updateRemaining);
  el.sold.addEventListener("input", updateRemaining);

  /* ---------- validation ---------- */
  function validate() {
    var inv = intOrNaN(el.inv.value), sold = intOrNaN(el.sold.value);
    if (!isFinite(inv) || inv < 0 || inv !== Math.floor(inv)) return "Enter inventory level as a whole number, 0 or more.";
    if (!isFinite(sold) || sold < 0 || sold !== Math.floor(sold)) return "Enter units sold as a whole number, 0 or more.";
    if (sold > inv) return "Units sold cannot be more than the inventory level.";
    if (current !== "remaining") {
      if (!el.category.value) return "Please select a category.";
      if (!el.region.value) return "Please select a region.";
      if (!el.season.value) return "Please select the seasonality.";
    }
    if (current === "order") {
      var d = intOrNaN(el.days.value), s = intOrNaN(el.safety.value);
      if (!isFinite(d) || d < 1 || d > 90 || d !== Math.floor(d)) return "Days to cover must be a whole number from 1 to 90.";
      if (!isFinite(s) || s < 0 || s > 100 || s !== Math.floor(s)) return "Safety stock must be a whole number from 0 to 100.";
    }
    return "";
  }

  function payload() {
    var p = { inventory: Number(el.inv.value), sold: Number(el.sold.value) };
    if (current !== "remaining") {
      p.category = el.category.value;
      p.region = el.region.value;
      p.season = el.season.value;
    }
    if (current === "order") {
      p.days = Number(el.days.value);
      p.safety = Number(el.safety.value);
    }
    return p;
  }

  /* ---------- result rendering ---------- */
  function stat(ic, label, value) {
    var d = make("div", "stat");
    d.appendChild(icon(ic, "stat-ico"));
    d.appendChild(make("span", "stat-label", label));
    d.appendChild(make("strong", "stat-value", value));
    return d;
  }

  function setLevel(level) {
    el.result.classList.remove("ok", "low", "out");
    if (level) el.result.classList.add(level);
  }

  function showEmpty() {
    setLevel("");
    el.result.replaceChildren();
    var box = make("div", "empty");
    var ic = make("div", "empty-icon");
    ic.appendChild(icon("calc"));
    box.appendChild(ic);
    box.appendChild(make("h2", "", "Your result will appear here"));
    box.appendChild(make("p", "", "Fill in the form and press “" + TABS[current].button + "”."));
    el.result.appendChild(box);
  }

  /* headline + sentence under the big number */
  function verdict(tab, r) {
    if (tab === "remaining") {
      var left = Math.round(100 - r.sell_through);
      if (r.level === "ok") return ["Your stock is sufficient!", "You have " + fmt(r.remaining) + " units left in inventory."];
      if (r.level === "low") return ["Stock is running low", "Only " + fmt(r.remaining) + " units left (" + left + "% of inventory)."];
      return ["Out of stock", "No units left. Restock as soon as possible."];
    }
    if (tab === "demand") {
      var cover = r.cover_days === null ? "many" : r.cover_days;
      if (r.level === "ok") return ["Stock covers the forecast", fmt(r.remaining) + " units last about " + cover + " days at " + r.demand + " units/day."];
      if (r.level === "low") return ["Stock cover is getting low", "About " + cover + " days of cover at " + r.demand + " units/day."];
      return [r.remaining <= 0 ? "Out of stock" : "Stock-out risk", r.remaining <= 0 ? "Nothing left to meet the forecast." : "Only about " + cover + " days of cover. Consider reordering now."];
    }
    if (r.order > 0) {
      return ["Place an order now", "Target " + fmt(r.target) + " (" + fmt(r.needed) + " for " + r.days + " days + " + fmt(r.safety_units) + " safety) minus " + fmt(r.remaining) + " in stock."];
    }
    return ["No order needed", "You hold " + fmt(r.remaining) + " units and the target is " + fmt(r.target) + "."];
  }

  function bigParts(tab, r) {
    if (tab === "remaining") return [fmt(r.remaining), "units remaining"];
    if (tab === "demand") return [String(r.demand), "units / day (avg, next 7 days)"];
    return [fmt(r.order), "units to order"];
  }

  function resultText(tab, r) {
    if (tab === "remaining") return fmt(r.remaining) + " units remaining";
    if (tab === "demand") return r.demand + " units/day (avg)";
    return fmt(r.order) + " units to order";
  }

  function render(r) {
    var level = r.level;
    setLevel(level);
    el.result.replaceChildren();

    var head = make("div", "result-head");
    var hi = make("span", "head-icon sm result-ico");
    hi.appendChild(icon(level === "out" ? "x" : (level === "low" ? "alert" : "check")));
    head.appendChild(hi);
    head.appendChild(make("h2", "", "Result"));
    el.result.appendChild(head);

    var bp = bigParts(current, r);
    var big = make("div", "big");
    big.appendChild(make("div", "big-num", bp[0]));
    big.appendChild(make("div", "big-unit", bp[1]));
    el.result.appendChild(big);

    var v = verdict(current, r);
    var msg = make("div", "msg");
    msg.appendChild(icon(level === "out" ? "x" : (level === "low" ? "alert" : "check"), "msg-ico"));
    var txt = make("div", "msg-text");
    txt.appendChild(make("strong", "", v[0]));
    txt.appendChild(make("span", "", v[1]));
    msg.appendChild(txt);
    el.result.appendChild(msg);

    var grid = make("div", "stats");
    if (current === "remaining") {
      grid.appendChild(stat("box", "Inventory level", fmt(el.inv.value)));
      grid.appendChild(stat("cart", "Units sold", fmt(el.sold.value)));
      grid.appendChild(stat("calc", "Remaining", fmt(r.remaining)));
    } else if (current === "demand") {
      grid.appendChild(stat("chart", "Likely range", r.low + " – " + r.high));
      grid.appendChild(stat("calc", "Stock left", fmt(r.remaining)));
      grid.appendChild(stat("clock", "Days of cover", r.cover_days === null ? "–" : r.cover_days));
    } else {
      grid.appendChild(stat("chart", "Demand / day", r.demand));
      grid.appendChild(stat("box", "Target stock", fmt(r.target)));
      grid.appendChild(stat("calc", "Stock left", fmt(r.remaining)));
    }
    el.result.appendChild(grid);

    countUp(big.firstChild);
  }

  /* ---------- count-up animation for the big number ---------- */
  function countUp(node) {
    var text = node.textContent;
    var target = parseFloat(text.replace(/,/g, ""));
    if (!isFinite(target)) return;
    var dot = text.indexOf(".");
    var decimals = dot === -1 ? 0 : text.length - dot - 1;
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    var start = null, ms = 800;
    function step(ts) {
      if (start === null) start = ts;
      var t = Math.min((ts - start) / ms, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = (target * eased).toLocaleString("en-IN", {
        minimumFractionDigits: decimals, maximumFractionDigits: decimals
      });
      if (t < 1) requestAnimationFrame(step); else node.textContent = text;
    }
    requestAnimationFrame(step);
  }

  /* ---------- history table ---------- */
  function drawLog() {
    el.log.replaceChildren();
    history.forEach(function (h, idx) {
      var tr = make("tr", "row");
      tr.appendChild(make("td", "t-time", h.time));

      var td = make("td");
      var pill = make("span", "pill tool " + TABS[h.tab].kind);
      pill.appendChild(icon(TABS[h.tab].icon));
      pill.appendChild(document.createTextNode(TABS[h.tab].title));
      td.appendChild(pill);
      tr.appendChild(td);

      tr.appendChild(make("td", "", h.io));

      var tr3 = make("td");
      var rp = make("span", "pill res " + TABS[h.tab].kind);
      rp.appendChild(icon("check"));
      rp.appendChild(document.createTextNode(h.out));
      tr3.appendChild(rp);
      tr.appendChild(tr3);

      var go = make("td", "t-go");
      var b = make("button", "row-go");
      b.type = "button";
      b.setAttribute("aria-label", "Open this calculation again");
      b.appendChild(icon("right"));
      go.appendChild(b);
      tr.appendChild(go);

      tr.addEventListener("click", function () { restore(idx); });
      if (idx === 0 && h.fresh) { tr.classList.add("fresh"); h.fresh = false; }
      el.log.appendChild(tr);
    });
  }

  function addLog(r, p) {
    var when = new Date().toLocaleString("en-US", {
      month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit"
    });
    history.unshift({
      time: when, tab: current, p: p, res: r, fresh: true,
      io: fmt(p.inventory) + " / " + fmt(p.sold),
      out: resultText(current, r)
    });
    history = history.slice(0, 30);
    drawLog();
  }

  /* click a row = reopen that calculation */
  function restore(idx) {
    var h = history[idx];
    if (!h) return;
    setTab(h.tab);
    el.inv.value = h.p.inventory;
    el.sold.value = h.p.sold;
    if (h.p.category !== undefined) { el.category.value = h.p.category; el.region.value = h.p.region; el.season.value = h.p.season; }
    if (h.p.days !== undefined) { el.days.value = h.p.days; el.safety.value = h.p.safety; }
    updateRemaining();
    render(h.res);
  }

  el.clear.addEventListener("click", function () { history = []; drawLog(); });

  /* ---------- submit ---------- */
  el.form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (busy) return;
    var msg = validate();
    el.error.textContent = msg;
    if (msg) return;

    busy = true;
    el.go.disabled = true;
    el.go.replaceChildren(make("span", "", "Working…"));
    var sent = payload();
    var tab = current;
    fetch(TABS[tab].url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sent)
    })
      .then(function (res) {
        return res.json().then(function (data) { return { ok: res.ok, data: data }; });
      })
      .then(function (out) {
        if (!out.ok) { el.error.textContent = out.data.error || "Something went wrong."; return; }
        if (tab !== current) return;      // user switched tab while waiting
        render(out.data);
        addLog(out.data, sent);
      })
      .catch(function () {
        el.error.textContent = "Cannot reach the server. Is app.py running?";
      })
      .then(function () {
        busy = false;
        el.go.disabled = false;
        setGo(TABS[current].button);
      });
  });

  setTab("remaining");
  updateRemaining();
  drawLog();
})();