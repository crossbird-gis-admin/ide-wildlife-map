"""奥州市農地調査マップ(oshu-survey-map)の data/ から、旧伊手村の範囲だけを切り出して data/ide.json を作る。
Python標準ライブラリのみで動作。

使い方:
  python tools/make_ide_data.py <oshu-survey-map の data フォルダ> [旧村名]
  例) python tools/make_ide_data.py ../oshu-survey-map/data 伊手村

出力 data/ide.json の中身:
  village … 旧村の境界(Polygon)
  rcom    … 農業集落 [{i:番号, n:集落名, lab:[lat,lng], g:Polygon}]
  fude    … 筆 [fid, 地目(1=田 2=畑), 農業集落の番号, Polygon]
"""
import glob, json, os, sys


def r5(c):
    return [r5(v) for v in c] if isinstance(c[0], list) else [round(c[0], 5), round(c[1], 5)]


def main(src, kson="伊手村", out="data/ide.json"):
    a = json.load(open(os.path.join(src, "areas.json"), encoding="utf-8"))
    vil = [f for f in a["kson"]["features"] if f["properties"]["KCITY_NAME"] == kson]
    if not vil:
        sys.exit(f"{kson} が areas.json にありません")
    rc = [f for f in a["rcom"]["features"] if f["properties"]["KCITY_NAME"] == kson]
    rset = {f["properties"]["i"] for f in rc}
    fude = []
    for p in sorted(glob.glob(os.path.join(src, "t", "*.json"))):
        for f in json.load(open(p, encoding="utf-8"))["features"]:
            pr = f["properties"]
            if pr.get("r") in rset:
                fude.append([pr["fid"], 1 if pr["地目"] == "田" else 2, pr["r"],
                             {"type": f["geometry"]["type"], "coordinates": r5(f["geometry"]["coordinates"])}])
    g = vil[0]["geometry"]
    res = {
        "village": {"type": g["type"], "coordinates": r5(g["coordinates"])},
        "rcom": [{"i": f["properties"]["i"], "n": f["properties"]["RCOM_NAME"], "lab": f["properties"]["lab"],
                  "g": {"type": f["geometry"]["type"], "coordinates": r5(f["geometry"]["coordinates"])}} for f in rc],
        "fude": fude,
    }
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as fo:
        json.dump(res, fo, ensure_ascii=False, separators=(",", ":"))
    print(f"{kson}: 農業集落 {len(rc)}、筆 {len(fude)} → {out} ({os.path.getsize(out)/1e6:.1f} MB)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(*sys.argv[1:3])
