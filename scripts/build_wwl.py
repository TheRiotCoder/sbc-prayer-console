#!/usr/bin/env python3
"""Builds data/wwl2026.json from the Open Doors World Watch List 2026 Top 50 (rank, country, total score).
Source: Open Doors International, World Watch List 2026 (published table/map: 'Top 50 Map-WWL 2026-ODI' and
'World Watch List 2026 - countries scoring 50+ points'). Open Doors publishes no public API/JSON; this is a manually
transcribed static dataset -> update each January when the new list is released."""
import json, subprocess, re, sys
names = """North Korea|Somalia|Yemen|Sudan|Eritrea|Syria|Nigeria|Pakistan|Libya|Iran|Afghanistan|India|Saudi Arabia|Myanmar|Mali|Burkina Faso|China|Iraq|Maldives|Algeria|Mauritania|Central African Republic|Morocco|Cuba|Uzbekistan|Niger|Tajikistan|Laos|DR Congo|Mexico|Tunisia|Nicaragua|Bangladesh|Bhutan|Turkmenistan|Ethiopia|Cameroon|Oman|Mozambique|Kyrgyzstan|Turkey|Egypt|Comoros|Qatar|Kazakhstan|Nepal|Colombia|Chad|Jordan|Brunei""".split("|")
scores = [97,94,93,92,90,90,89,87,87,87,86,84,82,81,81,80,79,79,79,77,76,75,75,73,73,72,72,72,72,71,71,71,71,71,71,70,70,70,69,68,68,68,68,67,67,67,66,66,65,65]
iso = dict(zip(names, "KP SO YE SD ER SY NG PK LY IR AF IN SA MM ML BF CN IQ MV DZ MR CF MA CU UZ NE TJ LA CD MX TN NI BD BT TM ET CM OM MZ KG TR EG KM QA KZ NP CO TD JO BN".split()))
assert len(names)==50==len(scores)==len(iso)
slug = lambda n: {"DR Congo":"drc","Central African Republic":"central-african-republic","Turkey":"turkey"}.get(n, re.sub(r'[^a-z]+','-',n.lower()).strip('-'))
out=[]
for i,(n,s) in enumerate(zip(names,scores),1):
    cat = "extreme" if s>=81 else "very_high"
    out.append({"rank":i,"country":n,"iso2":iso[n],"score":s,"category":cat})
json.dump({"list":"Open Doors World Watch List 2026","published":"January 2026","scale":"Extreme 81-100, Very high 61-80, High 41-60 (this file covers ranks 1-50 only)",
 "source":"https://www.opendoors.org/persecution/countries/","note":"Static transcription of the official Top 50 table; scores are totals out of 100.","countries":out}, open("data/wwl2026.json","w"), indent=1, ensure_ascii=False)
print("ok")
