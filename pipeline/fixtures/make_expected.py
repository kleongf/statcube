from __future__ import annotations

import importlib.util
import json
from pathlib import Path

REFERENCE = Path(__file__).resolve().parents[2] / "stats" / "epa_events.py"
FIXTURES = Path(__file__).resolve().parent


def load_reference():
    spec = importlib.util.spec_from_file_location("epa_events_reference", REFERENCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def on_field(match: dict, colour: str) -> list[int]:
    return [t["teamNumber"] for t in match["teams"] if t.get("onField") and t.get("alliance") == colour]


def main() -> None:
    ref = load_reference()
    fixture = json.loads((FIXTURES / "matches_2025.json").read_text())
    season = fixture["season"]
    p = ref.param_map[season]
    mean, a, pw = p["mean"], p["a"], p["p"]
    mean_auto, a_auto, p_auto = p["mean_auto"], p["a_auto"], p["p_auto"]
    k_max, k_min = 0.4 * abs(mean), 0.2 * abs(mean)
    k_max_auto, k_min_auto = 0.4 * abs(mean_auto), 0.2 * abs(mean_auto)

    played = [
        (code, m)
        for code, matches in fixture["events"].items()
        for m in matches
        if m["hasBeenPlayed"] and m["postResultTime"]
    ]
    played.sort(key=lambda cm: (
        cm[1]["postResultTime"], cm[0], sorted(on_field(cm[1], "Red")), sorted(on_field(cm[1], "Blue")),
    ))

    seen = set()
    ordered = []
    for code, m in played:
        key = (m["postResultTime"], frozenset(t["teamNumber"] for t in m["teams"] if t.get("onField")))
        if key not in seen:
            seen.add(key)
            ordered.append(m)

    state: dict[int, dict] = {}
    records: dict[int, dict] = {}
    names: dict[int, str] = {}
    for m in ordered:
        r1, r2 = on_field(m, "Red")
        b1, b2 = on_field(m, "Blue")
        for t in m["teams"]:
            names.setdefault(t["teamNumber"], (t.get("team") or {}).get("name") or f"Team {t['teamNumber']}")
        for n in (r1, r2, b1, b2):
            state.setdefault(n, {"epa": mean, "auto_epa": mean_auto, "matches_played": 0})
        red, blue = m["scores"]["red"], m["scores"]["blue"]
        four = (r1, r2, b1, b2)
        played_before = {n: state[n]["matches_played"] for n in four}

        new_total = ref.calculate_epa_update(
            *(state[n]["epa"] for n in four),
            red["totalPoints"], blue["totalPoints"],
            *(ref.calculate_k_factor(played_before[n], k_max, k_min) for n in four),
            a, pw,
        )
        new_auto = ref.calculate_epa_update(
            *(state[n]["auto_epa"] for n in four),
            red["autoPoints"], blue["autoPoints"],
            *(ref.calculate_k_factor(played_before[n], k_max_auto, k_min_auto) for n in four),
            a_auto, p_auto,
        )
        for n, ne, nae in zip(four, new_total, new_auto):
            state[n].update({"epa": ne, "auto_epa": nae})
            state[n]["matches_played"] += 1
            rec = records.setdefault(n, {"epa": {}, "auto_epa": {}, "teleop_epa": {}})
            rec["epa"][m["postResultTime"]] = round(ne, 4)
            rec["auto_epa"][m["postResultTime"]] = round(nae, 4)
            rec["teleop_epa"][m["postResultTime"]] = round(ne - nae, 4)

    teams = {}
    for n in sorted(records):
        rec = records[n]
        latest = max(rec["epa"])
        teams[str(n)] = {
            "team_name": names[n],
            **rec,
            "current_epa": rec["epa"][latest],
            "current_auto_epa": rec["auto_epa"][latest],
            "current_teleop_epa": rec["teleop_epa"][latest],
        }

    expected = {"season": season, "matches_rated": len(ordered), "teams": teams}
    (FIXTURES / "epa_expected.json").write_text(json.dumps(expected, indent=1) + "\n")
    print(f"wrote {len(teams)} teams from {len(ordered)} rated matches")


if __name__ == "__main__":
    main()
