#!/usr/bin/env python3
"""
Compare our silence detection with professional software output
"""
import json

# Load professional software output
with open('output.json', 'r') as f:
    pro_data = [json.loads(line) for line in f]

# Our detection (first 10 intervals from test endpoint)
our_intervals = [
    {"start": 0.0286458, "end": 0.49575, "duration": 0.4671042},
    {"start": 3.630688, "end": 4.106333, "duration": 0.4756450000000001},
    {"start": 6.459229, "end": 6.922042, "duration": 0.4628130000000006},
    {"start": 9.279187, "end": 9.728979, "duration": 0.4497920000000004},
    {"start": 12.35125, "end": 13.052083, "duration": 0.7008329999999994},
    {"start": 16.643771, "end": 17.078458, "duration": 0.43468700000000027},
    {"start": 20.241604, "end": 21.285396, "duration": 1.0437919999999998},
    {"start": 23.843271, "end": 24.219667, "duration": 0.37639599999999973},
    {"start": 27.483125, "end": 28.267896, "duration": 0.7847709999999992},
    {"start": 31.096417, "end": 31.707333, "duration": 0.6109159999999996}
]

print("=" * 80)
print("COMPARISON: Our Detection vs Professional Software")
print("=" * 80)
print()

print(f"Total intervals - Pro: {len(pro_data)}, Ours: 285")
print()

print("First 10 intervals:")
print("-" * 80)
print(f"{'#':<4} {'Pro Start':<12} {'Pro End':<12} {'Our Start':<12} {'Our End':<12} {'Diff':<10}")
print("-" * 80)

for i in range(min(10, len(our_intervals))):
    pro = pro_data[i]
    our = our_intervals[i]
    
    pro_start = pro['start']
    pro_end = pro['start'] + pro['duration']
    our_start = our['start']
    our_end = our['end']
    
    diff_start = abs(pro_start - our_start)
    diff_end = abs(pro_end - our_end)
    
    print(f"{i:<4} {pro_start:<12.3f} {pro_end:<12.3f} {our_start:<12.6f} {our_end:<12.6f} ±{max(diff_start, diff_end):.3f}s")

print()
print("=" * 80)
print("ANALYSIS")
print("=" * 80)

# Calculate average differences
total_start_diff = 0
total_end_diff = 0
count = min(50, len(our_intervals))

for i in range(count):
    if i < len(pro_data):
        pro = pro_data[i]
        our = our_intervals[i] if i < len(our_intervals) else None
        
        if our:
            pro_start = pro['start']
            pro_end = pro['start'] + pro['duration']
            our_start = our['start']
            our_end = our['end']
            
            total_start_diff += abs(pro_start - our_start)
            total_end_diff += abs(pro_end - our_end)

avg_start_diff = total_start_diff / count
avg_end_diff = total_end_diff / count

print(f"Average start time difference: {avg_start_diff:.3f}s")
print(f"Average end time difference: {avg_end_diff:.3f}s")
print()

# Check if pro software rounds to 0.1s
print("Rounding pattern in pro software:")
unique_decimals = set()
for entry in pro_data[:50]:
    start_decimal = entry['start'] % 1
    unique_decimals.add(round(start_decimal, 1))

print(f"Unique decimal values (first 50): {sorted(unique_decimals)}")
print()

print("Hypothesis: Pro software may be rounding to nearest 0.1s or using different padding")
