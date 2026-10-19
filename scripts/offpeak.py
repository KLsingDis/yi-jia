# -*- coding: utf-8 -*-
"""Report whether we're in DeepSeek's off-peak (cheap) window.

Peak (Beijing, UTC+8, 1x price):
    Mon-Fri (excluding Chinese statutory holidays), 09:00-12:00 and 14:00-18:00.

Off-peak (0.5x price): everything else, i.e.
    - weekdays 18:00-09:00 next day and 12:00-14:00;
    - all Saturday and Sunday;
    - all Chinese statutory holidays (pass them in).

Exit code: 0 = off-peak (safe to run translation agents), 1 = peak.

Usage:
    python offpeak.py [--json] [--now "YYYY-MM-DD HH:MM"] [--holiday YYYY-MM-DD]...
    DSH_HOLIDAYS=2026-10-01,2026-10-02 python offpeak.py

`--now` is only for offline tests (otherwise the real local clock is used).
"""
import datetime as dt
import json
import os
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

TZ = dt.timezone(dt.timedelta(hours=8))
WEEKDAY_CN = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']


def parse_args(argv):
    now = None
    as_json = False
    holidays = set()
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--json':
            as_json = True
            i += 1
        elif a == '--now' and i + 1 < len(argv):
            now = dt.datetime.strptime(argv[i + 1], '%Y-%m-%d %H:%M').replace(tzinfo=TZ)
            i += 2
        elif a == '--holiday' and i + 1 < len(argv):
            holidays.add(argv[i + 1].strip())
            i += 2
        else:
            i += 1
    for h in os.environ.get('DSH_HOLIDAYS', '').replace(';', ',').split(','):
        h = h.strip()
        if h:
            holidays.add(h)
    return now, holidays, as_json


def is_peak(t, holidays):
    if t.date().isoformat() in holidays:      # statutory holiday: all-day off-peak
        return False
    if t.weekday() >= 5:                      # Saturday / Sunday
        return False
    return (9 <= t.hour < 12) or (14 <= t.hour < 18)


def next_change(t, holidays):
    """Next moment the peak/off-peak state flips."""
    cur = is_peak(t, holidays)
    probe = t.replace(second=0, microsecond=0) + dt.timedelta(minutes=1)
    for _ in range(8 * 24 * 60):              # 8 days covers Fri evening -> Mon morning
        if is_peak(probe, holidays) != cur:
            return probe
        probe += dt.timedelta(minutes=1)
    return probe


def window_reason(t, holidays):
    if t.date().isoformat() in holidays:
        return '法定节假日全天谷时'
    if t.weekday() >= 5:
        return '周末全天谷时'
    if 9 <= t.hour < 12 or 14 <= t.hour < 18:
        return '工作日高峰（9-12 / 14-18 点）'
    return '工作日非高峰时段'


now, holidays, as_json = parse_args(sys.argv[1:])
if now is None:
    now = dt.datetime.now(TZ)

peak = is_peak(now, holidays)
flip = next_change(now, holidays)
minutes = int((flip - now).total_seconds() // 60)

info = {
    'beijing_now': now.strftime('%Y-%m-%d %H:%M:%S'),
    'weekday': WEEKDAY_CN[now.weekday()],
    'utc_now': now.astimezone(dt.timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
    'holiday': now.date().isoformat() in holidays,
    'window': 'peak' if peak else 'offpeak',
    'reason': window_reason(now, holidays),
    'price_multiplier': 1.0 if peak else 0.5,
    'next_change_beijing': flip.strftime('%Y-%m-%d %H:%M'),
    'next_change_utc': flip.astimezone(dt.timezone.utc).strftime('%Y-%m-%d %H:%M'),
    'minutes_until_change': minutes,
    'recommendation': (
        'PEAK: do not launch translation agents; only cheap work (files, scripts, checks)'
        if peak else
        'OFF-PEAK: safe to run translation batches (50% price)'
    ),
}

if as_json:
    print(json.dumps(info, ensure_ascii=False, indent=2))
else:
    print(f"北京时间 {info['beijing_now']}（{info['weekday']}）  /  UTC {info['utc_now']}")
    print(f"窗口: {'峰时（1x）' if peak else '谷时（0.5x）'} —— {info['reason']}")
    print(f"下次切换: 北京 {info['next_change_beijing']}（还有 {minutes // 60} 小时 {minutes % 60} 分）")
    print(info['recommendation'])

sys.exit(1 if peak else 0)
