# 유물 밸런스 점검 (2026-10-08) — 중간 저장

**상태: 미완료.** 사용자 결정(2026-10-08): "오늘은 지금 진행중인거까지 총 4개만 하고, 나머지는 아직 못했다고 저장해둬. 그 다음 유물을 더 많이 만들거야".

| 단계 | 상태 |
|---|---|
| 1. 측정 (유물 73개, 아래 표) | 완료 |
| 2. 계열별 분석 | **4/5 완료**: flame+blood+venom, clockwork+familiars+starter, shadow+storm+frost, star+trinkets. **미실행: 공통 규칙 + 공명 세트 (rules+sets)** |
| 3. 반박 검증 (작업 복사본에서 수정안 적용·재측정) | **미실행 (0/5)** |
| 4. 적용 · 재측정 · 테스트 | **미실행** — 게임 수치는 아직 하나도 바뀌지 않았다 |

아래 수정안은 **분석 단계의 제안이며 검증되지 않았다.** 적용 전에 3단계를 거칠 것 (수정안을 적용한 작업 복사본에서 `ITEM_AUDIT=artifacts` 재측정, 관련 테스트 확인).

## 다음에 할 일
1. 공통 규칙 + 공명 세트 분석 (미실행). 확인할 항목:
   a. 진자 추(pendulum_weight)가 상태 기계형 / 특수 탄환에 붙는 문제 (희귀인데 후반 +38%, 무리 x2.19 — 1위);
   b. 소환수 유물 복사본이 발동 관문(proc gate)을 공유하는 문제 (톱니 포탑 / 구전 정령 중복이 대부분 낭비, 단순 수정하면 제곱으로 커짐);
   c. 증폭 풀 밖의 'weak'(x1.25) / 고정 피해 가산;
   d. 치명타 전에 적용되는 발동 계수;
   e. 대시 탑재 유물 x 대시 쿨다운 유물 (쿨다운 하한 0.35 s에서 대시 발동 피해가 예산을 넘는지);
   f. 표식 소모 (여러 유물이 같은 표식을 소모 / 재부여);
   g. 광선 엠버 x0.5 이중 페널티;
   h. 아이템이 만든 탄환이 isPrimary로는 걸러지지만 일부 isAttack 상태 훅에서는 걸러지지 않는 문제;
   + 공명 세트(SetDef) 각 단계가 증폭 풀 / softBonus를 우회하는지.
2. 네 계열 수정안의 반박 검증 (제안별로 적용 → 재측정 → 확정 / 수정 / 기각).
3. 확정안 적용, 한국어 설명 수치 맞추기, `ITEM_AUDIT=artifacts` 전체 재측정, `BUILD_CEILING` 상한, 전체 테스트, 결정론 테스트.

## 기준
- 후반 빌드(무작위 유물 10개)에 하나를 얹었을 때 늘어나는 피해(중앙값): **일반 1.04–1.12, 희귀 1.08–1.16, 에픽 1.12–1.22, 전설 1.15–1.26** (전설은 수치보다 고유한 동작). 공격+방어 겸용은 비례해서 낮게.
- 무리(5마리) 상한(광역이 정체성인 유물은 상한까지): 일반 1.5, 희귀 1.8, 에픽 2.0, 전설 2.3. 3개 겹침은 대략 선형 이하.
- 이득이 없는 무기에 페널티만 걸리면 안 된다 (예: 바람 접부채를 근접 무기로 → 추가 탄 없이 피해 x0.75).
- 사용자 방향: "전설의 성능을 올릴게 아니라 전체적인 무기, 유물들의 성능을 내려야해" — 강한 것을 내리고, 수치 상향은 고장 / 무의미한 유물만.

## 측정값 (현재 HEAD, `ITEM_AUDIT=artifacts`)
기준 캐릭터(고유 능력 없음), 훈련 인형, 8초. alone = 무기 8종 단독 배율 중앙값 / 최대, crowd = 인형 5마리, x3 = 3개 겹침, late = 후반 빌드에 추가 (등불탄 / 못총 / 근접검).

| 유물 | 이름 | 등급 | alone 중앙/최대 | crowd | x3 | late 등불·못총·검 | 분석 |
|---|---|---|---|---|---|---|---|
| pendulum_weight | 진자 추 | 희귀 | 1.30 / 1.47 | 2.19 | 1.47 | 1.38 · 1.35 · 1.10 | 너무 강함 |
| kiln_core | 가마의 심장 | 에픽 | 1.33 / 1.46 | 2.10 | 1.78 | 1.31 · 1.30 · 1.25 | 너무 강함 |
| metronome_heart | 메트로놈 심장 | 에픽 | 1.23 / 1.29 | 1.34 | 1.78 | 1.34 · 1.28 · 1.23 | 너무 강함 |
| blood_pact | 피의 서약 | 에픽 | 1.25 / 1.25 | 1.25 | 1.75 | 1.25 · 1.25 · 1.25 | 정상 |
| abyssal_hourglass | 심연의 모래시계 | 전설 | 1.15 / 1.24 | 1.24 | 1.24 | 1.23 · 1.25 · 1.23 | 정상 |
| gear_turret | 톱니 포탑 | 희귀 | 1.21 / 1.38 | 1.31 | 1.44 | 1.23 · 1.21 · 1.23 | 고장 |
| cracked_hourglass | 금 간 모래시계 | 일반 | 1.15 / 1.19 | 1.19 | 1.54 | 1.23 · 1.21 · 1.20 | 너무 강함 |
| long_wick | 긴 심지 | 일반 | 1.22 / 1.29 | 1.24 | 1.57 | 1.20 · 1.20 · 1.23 | 너무 강함 |
| lantern_sun | 품 안의 태양 | 전설 | 1.34 / 1.42 | 2.38 | 1.77 | 1.20 · 1.20 · 1.19 | 수정 필요 |
| armillary | 작은 혼천의 | 에픽 | 1.07 / 1.23 | 1.15 | 1.10 | 1.12 · 1.17 · 1.25 | 수정 필요 |
| twin_shadow | 쌍둥이 그림자 | 에픽 | 1.18 / 1.37 | 1.37 | 1.73 | 1.22 · 1.17 · 1.12 | 정상 |
| tempest_heart | 폭풍의 심장 | 전설 | 1.15 / 1.24 | 2.29 | 1.24 | 1.24 · 1.16 · 1.12 | 수정 필요 |
| heartstring | 심장 실 | 희귀 | 1.20 / 1.20 | 1.20 | 1.60 | 1.15 · 1.16 · 1.16 | 정상 |
| quick_feather | 재빠른 깃털 | 일반 | 1.15 / 1.19 | 1.19 | 1.54 | 1.16 · 1.16 · 1.09 | 너무 강함 |
| wind_up_key | 태엽 열쇠 | 일반 | 1.05 / 1.05 | 1.05 | 1.15 | 1.12 · 1.16 · 1.15 | 수정 필요 |
| rusted_nail | 녹슨 못 | 일반 | 1.16 / 1.24 | 1.13 | 1.21 | 1.16 · 1.15 · 1.15 | 너무 강함 |
| black_candle | 검은 초 | 일반 | 1.15 / 1.15 | 1.15 | 1.45 | 1.15 · 1.11 · 1.15 | 너무 강함 |
| ball_lightning | 구전 정령 | 희귀 | 1.25 / 1.33 | 1.55 | 1.41 | 1.18 · 1.14 · 1.13 | 수정 필요 |
| glacier_lens | 빙하 렌즈 | 희귀 | 1.11 / 1.29 | 1.12 | 1.31 | 1.10 · 1.12 · 1.13 | 정상 |
| plague_censer | 역병 향로 | 희귀 | 1.21 / 1.26 | 1.98 | 1.24 | 1.10 · 1.10 · 1.11 | 너무 강함 |
| viper_fang | 독사의 송곳니 | 일반 | 1.13 / 1.24 | 1.24 | 1.30 | 1.11 · 1.10 · 1.07 | 너무 강함 |
| leech_tooth | 거머리 이빨 | 일반 | 1.10 / 1.10 | 1.10 | 1.30 | 1.10 · 1.10 · 1.10 | 정상 |
| tick_bomb | 째깍 폭탄 꾸러미 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.07 · 1.11 · 1.10 | 정상 |
| blood_moon | 핏빛 달 | 전설 | 1.10 / 1.10 | 1.10 | 1.30 | 1.10 · 1.09 · 1.09 | 정상 |
| frostbite_ring | 동상 반지 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.12 · 1.08 · 1.09 | 정상 |
| bellows | 작은 풀무 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.13 · 1.08 · 1.05 | 정상 |
| stormcaller_rod | 폭풍 부름 지팡이 | 에픽 | 1.06 / 1.08 | 1.00 | 1.20 | 1.09 · 1.04 · 1.08 | 약함 |
| constellation_needle | 별바늘 | 일반 | 1.05 / 1.21 | 1.12 | 1.24 | 1.09 · 1.08 · 1.03 | 정상 |
| swelling_seed | 부푸는 씨앗 | 일반 | 1.11 / 1.15 | 1.09 | 1.19 | 1.08 · 1.07 · 1.00 | 수정 필요 |
| tinder_pouch | 부싯깃 주머니 | 일반 | 1.10 / 1.17 | 1.17 | 1.27 | 1.09 · 1.07 · 1.02 | 정상 |
| comet_tail | 혜성 꼬리 | 에픽 | 1.06 / 1.14 | 1.00 | 1.00 | 1.13 · 1.06 · 1.07 | 정상 |
| fallen_star | 떨어진 별 조각 | 일반 | 1.06 / 1.08 | 1.00 | 1.20 | 1.05 · 1.06 · 1.07 | 수정 필요 |
| moon_satellite | 작은 달 | 희귀 | 1.00 / 1.13 | 1.31 | 1.00 | 1.02 · 1.06 · 1.16 | 정상 |
| smoldering_coal | 꺼지지 않는 숯 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.05 · 1.04 · 1.09 | 정상 |
| crystal_spiral | 빙정 나선 | 일반 | 1.00 / 1.08 | 1.18 | 1.00 | 1.07 · 1.00 · 1.05 | 정상 |
| crimson_edge | 진홍 칼날 | 희귀 | 1.11 / 1.19 | 1.16 | 1.28 | 1.05 · 1.08 · 1.04 | 정상 |
| rime_shard | 서리 조각 | 일반 | 1.00 / 1.12 | 1.12 | 1.12 | 1.06 · 1.05 · 1.02 | 정상 |
| winter_orb | 겨울을 품은 구슬 | 희귀 | 1.08 / 1.16 | 1.27 | 1.34 | 1.06 · 1.05 · 1.04 | 수정 필요 |
| lamp_oil | 등잔 기름 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.04 · 1.05 | 정상 |
| toad_idol | 두꺼비 우상 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.03 · 1.03 · 1.04 | 정상 |
| star_chart | 성도 | 희귀 | 1.00 / 1.26 | 1.00 | 1.00 | 1.02 · 1.02 · 1.02 | 정상 |
| nightshade_wreath | 까마중 화관 | 에픽 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.04 · 1.02 | 수정 필요 |
| rot_mushroom | 썩은 버섯 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.03 · 1.02 | 정상 |
| radiant_lance | 광휘의 창 | 전설 | 1.00 / 1.52 | 3.12 | 1.50 | 1.02 · 1.01 · 1.38 | 너무 강함 |
| fortune_moth | 복나방 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.02 · 1.04 | 수정 필요 |
| hollow_mask | 텅 빈 가면 | 희귀 | 1.06 / 1.19 | 1.12 | 0.91 | 1.01 · 0.93 · 1.06 | 약함 |
| alchemist_scale | 연금술사의 저울 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| sweet_sachet | 달콤한 향주머니 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| bramble_corset | 가시덩굴 코르셋 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| rekindle_plume | 재점화 깃털 | 에픽 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| hoarfrost_mantle | 상고대 망토 | 에픽 | 1.00 / 1.00 | 1.00 | 1.00 | 1.03 · 1.00 · 1.00 | 정상 |
| rear_eye | 등 뒤의 눈 | 일반 | 1.00 / 1.32 | 1.00 | 1.00 | 1.00 · 1.00 · 1.20 | 수정 필요 |
| static_cape | 정전기 망토 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.02 · 1.00 · 1.00 | 수정 필요 |
| paper_ward | 종이 부적 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 너무 강함 |
| jade_marble | 옥구슬 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| cluster_powder | 산탄 화약통 | 에픽 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 약함 |
| iron_quill | 무쇠 깃촉 | 일반 | 1.00 / 1.00 | 2.32 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| ember_reservoir | 불씨 저장고 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| smoke_veil | 연기 베일 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| shade_dagger | 그림자 단검 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 너무 강함 |
| ember_heart | 불씨 심장 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| soul_wax | 영혼 밀랍 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| greedy_purse | 탐욕의 지갑 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| ashwalk_boots | 잿불 장화 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 수정 필요 |
| twin_wick | 쌍심지 | 에픽 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| night_slippers | 밤의 덧신 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 너무 강함 |
| thunder_drum | 천둥 북 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.02 · 1.00 · 1.00 | 정상 |
| gilded_tooth | 금니 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 너무 강함 |
| stone_amulet | 돌거북 부적 | 일반 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| mirror_shard | 거울 파편 | 희귀 | 1.00 / 1.00 | 1.00 | 1.00 | 1.00 · 1.00 · 1.00 | 정상 |
| toxin_splitter | 맹독 분열낭 | 희귀 | 1.00 / 1.00 | 2.29 | 1.00 | 1.00 · 1.00 · 1.00 | 너무 강함 |
| copper_coil | 구리 코일 | 일반 | 1.00 / 1.12 | 1.15 | 1.12 | 1.03 · 0.98 · 1.00 | 정상 |
| paper_fan | 바람 접부채 | 희귀 | 1.01 / 1.35 | 1.34 | 1.16 | 0.86 · 1.10 · 0.75 | 수정 필요 |

## 분석: flame+blood+venom (검증 전)

정상 판정 15개: 부싯깃 주머니(tinder_pouch), 꺼지지 않는 숯(smoldering_coal), 작은 풀무(bellows), 재점화 깃털(rekindle_plume), 불씨 저장고(ember_reservoir), 쌍심지(twin_wick), 거머리 이빨(leech_tooth), 가시덩굴 코르셋(bramble_corset), 무쇠 깃촉(iron_quill), 진홍 칼날(crimson_edge), 심장 실(heartstring), 피의 서약(blood_pact), 핏빛 달(blood_moon), 썩은 버섯(rot_mushroom), 두꺼비 우상(toad_idol)

### 잿불 장화 (ashwalk_boots) — 희귀, 수정 필요, 확신 high
- 파일: src/content/items/flame.ts
- 실제 동작: onDash: one fire puddle at the dash origin. Radius 9, lasts 2.4 s, ticks every 0.3 s for 0.35×dmg, adds burn 0.3×dmg for 2 s. It goes through HazardZone.add (cap 28) and the onDash puddle ignores power. onUpdate is meant to lay a trail every 8 px for dashTime+0.04 s, with power scaling (stackMul damage, life +0.6 per copy). The onDash puddle uses up the 0.2 s per-artifact proc interval, and the trail window (0.15+0.04 = 0.19 s) is shorter than that interval. So whenever enemies are present, every trail puddle is refused and HazardZone.add marks it dead. The trail only paints in cleared rooms.
- 측정: Audit: 1.00 (no dash). Dash bot dashing at or through the immobile dummy. Every 1 s: single 1.502 (lantern) / 1.517 (blade), crowd 2.00 / 1.42. Every 2 s: single 1.35 / 1.46, crowd 1.69 / 1.24. Puddles spawned: exactly 60 in 60 s (one per dash). Two copies give the same numbers as one (1.502 = 1.502). A variant with only the onDash puddle also gives the same numbers.
- 문제:
  - A second copy does nothing: the onDash puddle ignores power and the power-scaled trail never spawns in combat.
  - The onUpdate trail is dead code in combat: its 0.19 s window is shorter than MIN_PROC_INTERVAL 0.2 s.
  - Dash-bot values (1.35–1.50) are a best case: an immobile dummy dashed through every 1–2 s. In real play enemies cross a radius-9 puddle briefly, so I estimate +10–20%.
- 제안: Keep it as one puddle per dash, and let copies scale it. In onDash: HazardZone.add(w, new HazardZone(w, p.x, p.y + 2, 'fire', { radius: 9, life: 2.4 + 0.6 * (power - 1), tick: 0.3, damage: dmg(w) * 0.35 * stackMul(power), statuses: [{ kind: 'burn', duration: 2, power: dmg(w) * 0.3 }] }), 28). Add `power` to the onDash signature: onDash(w, power). Delete the onUpdate trail block and the __ashT/__ashX/__ashY vars. Do not make it a real trail: overlapping fire zones share one tick per enemy, so a trail only adds coverage, and the dash-crowd number is already ~2.0. Optional detail text: '대시를 시작한 자리에 2.4초간 불길이 남는다. 중복 시 피해·지속 증가. 추가 효과 최소 간격 0.2초, 같은 적 상태 재부여 0.5초. 중복·무기 교체 시 간격 공유.'
- 기대 결과: 1 copy unchanged (dash bot 1.35–1.50, realistic +10–20%). 2 copies: puddle damage ×1.6, 3.0 s life (today identical to 1 copy).

### 가마의 심장 (kiln_core) — 에픽, 너무 강함, 확신 high
- 파일: src/content/items/flame.ts
- 실제 동작: onHit on a primary hit: bank += dealt damage (cap 3.34×dmg). blast = clamp(bank×0.3, 0.25×dmg, 1.0×dmg)×stackMul(power). miniBlast radius 20+3 per copy around the struck target (it hits the target too); the bank resets on success. At most one blast per 0.2 s (effectProc). So every weapon gets +30% single-target damage. The 0.25×dmg floor per blast favours fast small-hit weapons (nail +36%). Note: the 'grow' look is visual only. The lantern 1.46 is crit noise; the real add is exactly 3 per 10-dmg bolt.
- 측정: Audit: alone 1.46/1.36/1.30/1.30/1.29/1.33/1.40/1.32, crowd L 2.10 (nail 2.12, blade 1.86, gatling 2.10), x3 1.78, late 1.31/1.30/1.25 (my harness reproduces all of these exactly). Robust late 1.315/1.321/1.271. Kill waves (6-mob clusters): ×1.70/2.08/1.68 kills, legendary level (tempest_heart ×2.03/2.48/1.49).
- 문제:
  - Late 1.25–1.32 is well above the epic band (1.12–1.22). Crowd 2.10 is above the epic cap 2.0.
  - +30% on single targets including bosses, on top of an AoE identity.
  - The 25% floor per blast gives many-small-hit weapons up to 5×0.25 = 1.25 base dmg/s regardless of their damage.
- 제안: flame.ts kiln_core onHit: const blast = Math.max(base * 0.1, Math.min(base * 0.6, w.vars.__kilnBank * 0.18)) * stackMul(power); Keep the bank cap at 3.34×base, so the maximum blast is 0.6×base and slow heavy hits still make the biggest blasts. Update the detail text (desc unchanged).
- 새 설명: desc 그대로. detail: '최소 간격 0.2초. 직전 폭발 이후 모인 직접 피해의 18%로 폭발(공격력의 10~60%). 느린 강타는 큰 폭발. 추가 파편 제외. 추가 효과 최소 간격 0.2초, 같은 적 상태 재부여 0.5초. 중복·무기 교체 시 간격 공유.'
- 기대 결과: Measured variant (0.18, floor 0.1): alone 1.32(L, crit noise)/1.16/1.18/1.18/1.20/1.16. Crowd L1.69 N1.51 B1.52 G1.61. x3 1.51 (sublinear). Late 8 s 1.21/1.16/1.13; robust late 1.150/1.160/1.143. Kill waves ×1.38/1.50/1.49.

### 독사의 송곳니 (viper_fang) — 일반, 너무 강함, 확신 high
- 파일: src/content/items/venom.ts
- 실제 동작: modifyHit: attack hit, rollHit at 20% → poison for 4 s at 0.22×dmg/s per stack. Each application is its own stack (cap 8), and all poison stacks share the strongest power. So viper's 0.22 also raises the stacks from censer, rot_mushroom and the venom set.
- 측정: Audit: alone 1.24/1.13/1.08/1.17/1.08/1.05/1.15/1.13, late 1.11/1.10/1.07. That late figure is deflated by the audit cache bug; with a correct cache, 8 s: 1.12/1.12/1.11. 90 s alone: 1.118/1.147/1.116/1.143/1.132. Robust late 1.143/1.130/1.114: above the common band (1.12) and above the rare crimson_edge.
- 문제:
  - The strongest common DoT, and stronger than the rare crimson_edge that does the same job.
  - Its high power upgrades every other poison stack in the build.
- 제안: venom.ts viper_fang: addHitStatus(... { kind: 'poison', duration: 4, power: dmg(w) * 0.16 }). Chance stays at 20%, so the desc does not change. I also tested 0.18: robust late 1.093/1.082/1.083, which only ties crimson.
- 기대 결과: Measured with 0.16: 90 s alone 1.087/1.108/1.080/1.102/1.096 (below crimson on every weapon). Robust late 1.084/1.078/1.076, mid common band.

### 부푸는 씨앗 (swelling_seed) — 일반, 수정 필요, 확신 high
- 파일: src/content/items/venom.ts
- 실제 동작: stats: range ×(1+0.1p). onShoot on a gen-0 projectile: growBehavior(2.2, 0.45+0.15p). Size grows up to 2.2× and the damage bonus grows with traveled/range through mem.amp (pooled once per hit). Melee and beam weapons gain nothing and lose nothing. It never calls proc().
- 측정: alone 1.15/1.12/1.00/1.00/1.09/1.07/1.11/1.11, crowd 1.09, x3 1.19 (sublinear: more range slows the growth), late 1.08/1.07/1.00. Robust late 1.092/1.105/1.000.
- 문제:
  - Presence rule: the effect fires on every shot but proc(w, id) is never called, so the HUD row never flashes (the presence test only checks look and signature).
- 제안: venom.ts swelling_seed onShoot: if (p.generation === 0) { p.addBehavior(growBehavior(2.2, 0.45 + 0.15 * power)); proc(_w, 'swelling_seed', true); }. No number change.
- 기대 결과: numbers unchanged; quiet HUD flash added

### 역병 향로 (plague_censer) — 희귀, 너무 강함, 확신 high
- 파일: src/content/items/venom.ts
- 실제 동작: onUpdate: every 0.6 s (effectInterval), one poison stack (3 s, 0.15×dmg/s) on every enemy within 40+10(p−1) px. Anything that stays close sits at about 5 stacks, and those stacks take the strongest poison power present. Copies only widen the radius. Particles are fx-only. onUpdate is not an event hook, so it never procs or flashes.
- 측정: Audit: alone 1.20–1.26 (the dist-40 engagement puts the dummy inside the aura), crowd 1.98 (N 1.87, G 1.86, B 1.27), x3 1.24, late 1.10/1.10/1.11. That late figure is deflated by the audit cache bug; with a correct cache, 8 s: 1.17/1.17/1.16. Robust late 1.253/1.220/1.215. Kill waves ×1.00 L / ×1.02 N / ×1.23 B: the ranged bot never comes within 47 px, so this is a melee/close-range item.
- 문제:
  - Above the rare band (1.16) once measured correctly and over long fights. Crowd 1.98 is over the rare cap 1.8.
  - No proc feedback.
- 제안: venom.ts plague_censer onUpdate: inflict(w, e, { kind: 'poison', duration: 3, power: dmg(w) * 0.12 }, false). Also, when at least one inflict succeeds, call proc(w, 'plague_censer', true). No desc numbers.
- 기대 결과: Measured with 0.12: late 8 s 1.10/1.12/1.14, robust late 1.149/1.142/1.137. Crowd L1.78 N1.70 B1.22 G1.69. Blade kill waves ×1.18. I also tested 0.13: robust 1.154/1.147/1.146, crowd 1.84.

### 맹독 분열낭 (toxin_splitter) — 희귀, 너무 강함, 확신 high
- 파일: src/content/items/venom.ts
- 실제 동작: onHit on a primary hit: spawnShards fires 3 drops (ranged and beam) or 2 (melee), plus (power−1), in a 2.4 rad fan forward. Each drop deals 0.4×dmg and applies poison for 3 s at 0.18×dmg/s, and the drops skip the struck target. The only limit is the 0.2 s per-artifact interval (up to 5 bursts/s). It is not tied to the keeper's cadence, so fast weapons multiply it.
- 측정: Single target 1.00 everywhere (late 1.00, x3 1.00). Crowd L 2.29, N 2.83 (fast weapon), B 1.14, gatling 2.10. Kill waves ×1.55/1.85/1.14. With only a cadence gate: crowd L 2.29, N 2.21.
- 문제:
  - Rule: a per-attack spawner not limited to the keeper's cadence. Nail and gatling get up to 5 bursts/s.
  - Crowd far over the rare cap 1.8 (2.29 L, 2.83 N).
- 제안: venom.ts toxin_splitter onHit, right after `if (!isPrimary(hit)) return;`: `if (!cooldown(w, 'toxin_splitter', 1 / Math.max(0.5, w.player.stats.fireRate))) return;` (same pattern as rear_eye and twin_shadow; import cooldown is already there). Then damage: dmg(w) * 0.25 and poison power: dmg(w) * 0.12. Counts stay 3 and 2, so the desc is unchanged; only the detail text changes.
- 새 설명: desc 그대로. detail: '직접 공격만 발동하며 등불지기의 기본 공격 속도보다 자주 터지지 않는다. 광선은 3개. 독 방울은 처음 맞힌 적을 다시 맞히지 않는다. 추가 효과 최소 간격 0.2초, 같은 적 상태 재부여 0.5초. 중복·무기 교체 시 간격 공유.'
- 기대 결과: Measured: crowd L1.82 N1.77 B1.09 G1.56 (at the cap, which is fine for an AoE-identity item). Kill waves ×1.29/1.42/1.09. Single target 1.00.

### 까마중 화관 (nightshade_wreath) — 에픽, 수정 필요, 확신 high
- 파일: src/content/items/venom.ts
- 실제 동작: onKill of a poisoned enemy: addEmber(5×power) (scaled by luck), a ring fx, then for each enemy within 60 px it tries min(4, stacks+1) poison inflicts (4 s, max(dying enemy's power, 0.2×dmg)). Every inflict goes through procStatusFor → runProcStatus('a:nightshade_wreath:poison', targetId, 0.5 s). That blocks every inflict after the first on the same target, so only ONE stack ever transfers and the i≥1 iterations are dead code.
- 측정: DPS harness 1.00 (no kills), robust 1.01. Kill waves with viper_fang as the poison source: viper alone ×1.00/1.05/1.04, viper+nightshade ×1.37/1.43/1.20. So nightshade alone adds +37%/+36%/+15% kills, about the epic AoE level of kiln after its nerf (×1.38/1.50/1.49). With the stack transfer actually working (tested): ×1.72/1.70/1.23, an unwanted buff.
- 문제:
  - The multi-stack spread loop is dead code (status reapply interval), so the code claims more than it does.
  - No proc feedback when no enemy is nearby, even though ember is gained.
- 제안: Keep the current behaviour and make the code honest. In onKill: w.player.addEmber(5 * power); proc(w, 'nightshade_wreath'); then `for (const o of enemiesNear(w, e.x, e.y, 60)) if (o !== e) inflict(w, o, { kind: 'poison', duration: 4, power: Math.max(s.power, dmg(w) * 0.2) });`. Do NOT make the stacks transfer (that would be a +35% buff). No number or desc change.
- 기대 결과: unchanged: kill waves +37%/+36%/+15% over the poison source

<details><summary>정상 판정 유물의 근거</summary>

- **부싯깃 주머니 (tinder_pouch)**: modifyHit: on an attack hit (projectile, melee, beam tick or weapon explosion), rollHit at 15% × hitShare (copies stack as 1-(0.85)^n) → addHitStatus burn for 3 s at 0.4×keeper dmg/s. Burn does not stack; a refresh keeps the higher power and the longer time. Limits: one proc per 0.2 s per artifact and one reapply per target per 0.5 s. Works on every weapon kind. 측정: Audit: alone 1.17/1.07/1.10/1.14/1.05/1.06/1.12/1.07, crowd 1.17, x3 1.27, late 1.09/1.07/1.02. My 90 s alone: L1.100 N1.109 B1.080 G1.102 V1.090. Robust late (median of 16 builds, 24 s, hollow_mask removed): 1.075/1.055/1.052.
- **꺼지지 않는 숯 (smoldering_coal)**: modifyHit: if the target is burning, amplify +0.2×power. The bonus is pooled per hit and applies to every non-status hit, including item hits. It needs a burn source: tinder, flame resonance II, the release burn, ashwalk or rekindle. Its 'flame' tag also counts toward flame resonance II (20% burn). proc is quiet. 측정: Audit: alone 1.00 (no burn source), late 1.05/1.04/1.09. Late with a correct cache, 8 s: 1.04/1.00/1.04. Robust late (24 s, 16 builds): 1.124/1.136/1.137. Kill waves, tinder+coal vs tinder alone: +6%/+9%/+3% kills.
- **작은 풀무 (bellows)**: onHit on a primary hit: addEmber(0.3×power×hit.emberCharge). emberCharge is the charge applyHit already computed, so beam and boss halving already apply. Shards, DoTs and releases give no extra. proc is quiet. More releases is its only effect. 측정: Audit: alone 1.00 (the bot never releases), late 1.13/1.08/1.05. Robust late 1.080/1.105/1.071; this comes from synergy with items that read ember. With a release-pressing bot (90 s × 3 seeds, plain keeper): releases go 15→21, dps +4.6%/+4.8%/+4.4% (L/N/B). x3: releases 30–33, +10.8%/+13.1%/+10.5% (linear).
- **재점화 깃털 (rekindle_plume)**: onHurt when the keeper is no longer alive: red = min(maxRed, 4), or 4 soul if maxRed is 0. Also: invuln 2.2 s, clears enemy bullets, itemHit 4×dmg (knockback 300) plus burn 0.6×dmg for 4 s on enemies within 100 px, then removes itself. It is unique. Player.hurt calls onHurt before playerDied, so the revive works solo and in co-op (it runs before the downed state). 측정: DPS-neutral. Checked by reading the code: the revive path is correct. 메모: No number change. Optional: in onHurt, return early when the blood resonance V oath is still available this floor (w.vars.__bloodOathFloor !== w.run.floor and the blood tier-5 set is active), so the free per-floor save goes first.
- **불씨 저장고 (ember_reservoir)**: onRelease: a 6 s buff ('불씨 폭주') that multiplies damage by (1+0.25×power) and fireRate by 1.15. Buffs are effects, so both go into the pooled stats. The buff also makes cosmetic fx particles and calls shout, which procs. 측정: Audit: 1.00 (no release). Release bot, 90 s × 3 seeds, plain keeper: +12.6% L / +18.3% N (18 releases vs 15, because the buff speeds charging) / +12.9% B. x3: +29%/+39%/+30% (≤ linear). Together with twin_wick: 1.37/1.44/1.34. Most of that synergy is flame resonance II switching on (2 flame tags → 20% burn), not a bug.
- **쌍심지 (twin_wick)**: onRelease: 0.55 s later it calls character.release (or defaultRelease) again, min(2, power) times, 0.55 s apart. The echo does not fire onRelease items and does not set the cooldown or the 0.6 s invuln. Room change or death cancels it. proc and shout fire on each echo. 측정: Audit: 1.00 (no release). Release bot with the plain keeper's default release (4×dmg + burn): +8.1%/+8.1%/+7.9%. 2 copies: +17.4%/+17.1%/+16.5% (linear). With character releases worth 10–15×dmg, I expect ~+15–20% for one copy. 메모: No change now. If build-ceiling shows boss melt with release builds: while twin_wick runs the echo, set a w.vars flag and have resolve.ts treat those hits as non-release for the burst budget only.
- **거머리 이빨 (leech_tooth)**: stats: damage +1×power, a flat add before the multipliers. onKill: fx blood drops fly to the keeper (cosmetic signature); roll(0.05, power, luck 0.005) heals ½♥ when red is not full, then proc. In co-op the kill belongs to the last hitter. 측정: alone 1.10 on all weapons, crowd 1.10, x3 1.30, late 1.10. Robust late 1.091.
- **가시덩굴 코르셋 (bramble_corset)**: onHurt: on every enemies within 58 px, itemHit 2.5×dmg×stackMul(power) (knockback 200) plus bleed 0.3×dmg for 3 s. One proc per 0.2 s, and in practice once per invuln window. It also fires on lethal and self-inflicted damage (status ticks, own bombs). 측정: Not measurable (the harness keeper is in god mode). Analytic: about 3.4 keeper hits to each nearby enemy per hurt, plus a knockback that helps defensively.
- **무쇠 깃촉 (iron_quill)**: stats: pierce +power, shotSpeed ×1.1. onShoot on a generation-0 projectile: after each enemy hit, amplifyShot +0.2, at most 3 times (+60%). The first hit gets nothing, so single targets gain 0. Melee and beam weapons gain nothing and lose nothing. 측정: alone 1.00 everywhere, x3 1.00, late 1.00. Crowd L 2.32 N 2.15 G 2.30 B 1.01. Kill waves ×1.28/1.73/1.09. Variants: per-pierce bonus 0.1 → crowd 2.22, kills 1.26/1.65; bonus 0 (pure pierce +1) → crowd 2.12, kills 1.26/1.55. 메모: No change. The crowd figure is the geometric best case for pierce (see crossCutting).
- **진홍 칼날 (crimson_edge)**: modifyHit: attack hit, rollHit at 15% → bleed for 3 s at 0.3×dmg/s per stack. Each application is its own stack (cap 8), and all stacks share the strongest power. Interval limits are the same as tinder. 측정: Audit: alone 1.16/1.05/1.07/1.19/1.08/1.05/1.12/1.11, late 1.05/1.08/1.04. An 8 s run gets only ~3 procs, so this is very noisy. 90 s alone: L1.100 N1.128 B1.089 G1.129 V1.104. Robust late 1.076/1.105/1.080, the bottom of the rare band. Today it is below the common viper_fang on every weapon (viper 90 s: 1.118/1.147/1.116/1.143/1.132). Duration 4 s variant tested: 90 s alone +3–5%, late +0.00–0.02. 메모: No change. After viper_fang drops to 0.16, crimson beats it on every weapon.
- **심장 실 (heartstring)**: modifyHit: when maxRed > 0 and red ≥ maxRed, and the hit is not a status tick: amplify +0.2×power (quiet proc). onShoot tints gen-0 shots while the condition holds. It never helps soul-only keepers. 측정: alone 1.20 everywhere, x3 1.60 (linear), late 1.15/1.16/1.16. Robust late 1.160/1.160/1.177. The harness is always at full HP, so this is an upper bound.
- **피의 서약 (blood_pact)**: stats: mulStat damage ×1.25 (pooled), maxHearts −1. It is unique, so power is 1. onHurt while alive sets __pactN = 2: the next 2 attack hits (beam ticks count) become crits via hit.crit = true; hit.damage *= critMult. This copies World.applyHit's crit path and is guarded by !hit.crit, so it is a crit, not a stacking item bonus. 측정: 1.25 on every weapon and metric (alone, crowd, late; robust 1.250). The post-hurt crits are not measurable in god mode. 메모: No change. Optional, only if the team wants the epic band to be strict: mulStat('damage', 1 + 0.2 * power) with desc '공격력 +20%, 최대 체력 -1칸. 피격 후 2회 치명타' → 1.20.
- **핏빛 달 (blood_moon)**: stats: damage +power (flat). onKill (own 0.04 s gate plus the 0.2 s proc interval): spawnShards fires 3+power homing spectral darts at 0.6×dmg each, with bleed 0.25×dmg for 3 s (deferred per target), toward other enemies. A small blood moon orbits the keeper (draw/fx only). 측정: Immortal dummies: 1.10 alone, late 1.09 (just the +1 dmg). Below the legendary band on single targets. Kill waves (6-mob clusters, 45 HP floor-1 regulars, 60 s × 3 seeds): ×2.07 L / ×2.18 N / ×1.67 B kills. 2 copies: ×2.83/3.03/1.87 (about linear). That matches the other AoE legendaries: tempest_heart ×2.03/2.48/1.49, radiant_lance ×2.09/2.03/1.17.
- **썩은 버섯 (rot_mushroom)**: stats: maxHearts +power. onRoomEnter into an uncleared room: 0.8 s later, one poison stack on every enemy within 80+10(p−1) px, lasting 4+(p−1) s at 0.2×dmg, with an explicit proc. Copies widen and lengthen it but do not raise its power. Co-op: onRoomEnter is dispatched to every keeper. 측정: late 1.00/1.03/1.02, robust 1.01. The harness never enters a room, so only the heart counts there.
- **두꺼비 우상 (toad_idol)**: stats: luck +power. Luck adds to proc chances (0.012 per luck, weighted by hitShare) and to ember gain (+2% per luck). onKill of a poisoned enemy: roll(0.15, power, luckK 0) drops a coin, with proc. 측정: late 1.03/1.03/1.04, robust 1.055/1.035/1.035 (from luck feeding other procs).

</details>

분석가가 본 계열 밖의 문제:
- tests/item-audit.test.ts lateBase cache bug: lateBase(wid, i, b) caches by `${wid}\|${i}`, but b is b0 filtered for the current artifact and then sliced to 10. For an artifact that appears in a late build, the baseline is a different set that can already contain the artifact (ratio ≈1). When the shard's first artifact sits in a build, every later artifact on that build gets a mismatched baseline. Corrected: plague_censer 1.10/1.10/1.11 → 1.17/1.17/1.16; viper_fang 1.11/1.10/1.07 → 1.12/1.12/1.11. kiln_core is in no build, and my clone reproduces its numbers exactly. Fix: key the cache by `${wid}\|${b.join(',')}`.
- Harness noise in tests/dpsharness.ts: in 8 s the lantern_bolt alone baseline happened to roll zero crits (exactly 25.00 dps). Any artifact that consumes w.rng shifts the crit rolls, so lantern 'alone' ratios carry about +0–8% noise (kiln 1.46 on lantern vs a true +30%). DoT items get only 2–6 procs and their 3–4 s stack ramp in 8 s, so they are under-read: plague_censer 8 s 1.17 vs 24 s 1.22–1.25, smoldering 1.04 vs 1.13. Suggestion: critChance 0 in measureDps, plus 24 s runs and the median of 16 builds for the onLate column.
- hollow_mask (shadow.ts): fear on the immobile training dummy makes it flee, so lantern dps over 60 s collapses from 25 to 5.2. Late build 7 (AUDIT-ART-LATE) contains it and drops from 61 to 10.7 dps over 60 s. The 8 s audit is barely affected, but any longer harness run with it is invalid, and its x3 0.91 comes from this. Exclude it from long-run builds or pin the dummy against fear.
- Crowd metric vs pierce: the 5-dummy plus layout puts a dummy directly behind the target, so any pierce +1 reads ~2.1–2.3 regardless of the item's own numbers (iron_quill 2.32; the pure-pierce variant 2.12). That applies to the blessing pierce +1 (blessings.ts:86) and kit-serin as well. Judge pierce and line AoE against a scattered layout before applying the crowd caps.
- twin_wick echo releases carry hit.release, so they skip the boss burst budget and wards in content/bosses/resolve.ts (lines 224–245). Two copies give 3 boss-exempt releases per gauge. Check BUILD_CEILING with release-heavy builds; if needed, flag echo hits as non-release for the budget only.
- Per-artifact proc interval (procs.ts MIN_PROC_INTERVAL 0.2 s) vs trails laid over several frames: a trail window shorter than 0.2 s never places a second zone while enemies are alive (ashwalk_boots trail is dead in combat). kit-ria.ts:139 lays its fire trail through HazardZone.add inside the passive proc context, so it is likewise limited to one puddle per 0.2 s. Confirm that is intended.
- Poison stacks share the strongest power (entity.applyStatus: cur.power = max). The highest-power poison source upgrades every stack from every other source (censer's ~5 stacks at viper's power), and venom resonance V adds +5% amp per stack, up to +40%. With censer alone that is ~+25% on all hits against poisoned targets. Keep poison powers close together (venom II 0.2, rot 0.2, proposed viper 0.16 / censer 0.12 / toxin 0.12), and have the resonance analyst measure venom V with the censer.
- Resonance tag counting: any two flame artifacts switch on flame II (20% burn at 0.4×dmg). Much of smoldering_coal's and the ember_reservoir+twin_wick measured value is the set tier, not the item. Flame II and venom II are stronger than the commons tinder_pouch and viper_fang; that is fine, but keep the items below their set tier.
- Hook order: artifact hooks run before resonance tiers, so rekindle_plume is used up before blood resonance V's once-per-floor cheat death can trigger. Consider dispatching set onHurt before artifacts, or have the plume defer to an unused oath.

메모: I reproduced the audit with a scratch copy of measureDps: kiln_core matched it exactly (alone, crowd, x3 and late). On top of that I added a release-pressing bot, a dashing bot, waves of killable mobs (6-mob clusters, 45 HP floor-1 regulars, 60 s × 3 seeds), and a robust late metric (median of 16 AUDIT-ART-LATE builds, 24 s, hollow_mask removed). Proposed numbers were tested as hidden variant artifacts defined in the scratch test. All scratch files under tests/ are deleted and git status is clean. Proposed changes are all trims or fixes; there are no raw-number buffs: - kiln_core: blast is 18% of the bank, 10–60% of dmg (robust late 1.32 → 1.15, crowd 2.10 → 1.69). - toxin_splitter: keeper-cadence gate, drop 0.25×dmg, poison 0.12 (crowd 2.29/2.83 → 1.82/1.77). - plague_censer: poison 0.15 → 0.12 (robust late 1.22–1.25 → 1.14–1.15, crowd 1.98 → 1.78), plus a quiet proc. - viper_fang: poison 0.22 → 0.16 (robust 1.13 → 1.08). This also fixes the inversion where the rare crimson_edge was weaker than this common; crimson itself is left unchanged. - ashwalk_boots: copies were a no-op and the onUpdate trail is dead code in combat. Scale the single puddle with power instead. - nightshade_wreath: the multi-stack spread loop is dead code (status reapply gate). Keep the behaviour, simplify the code, add a proc. - swelling_seed: add a quiet proc (presence rule). Everything else is within its band: tinder_pouch, smoldering_coal (borderline), bellows, rekindle_plume, ember_reservoir, twin_wick, leech_tooth, bramble_corset, iron_quill (pierce best-case crowd), crimson_edge, heartstring, blood_pact (+0.03 over the band, paid with a heart; unique), blood_moon (room clear ×2.07 kills, the same tier as the other AoE legendaries), rot_mushroom, toad_idol. Rule checks across the three files: no Math.random and no `**`; fx is used only for particles; w.vars is per keeper and hooks run in the owning keeper's context, so co-op is fine; stacking is linear or uses stackMul; amplify / amplifyShot are used for per-hit bonuses (blood_pact's forced crit copies the World crit path and is not a stacking bonus); per-hit procs use rollHit; Korean desc numbers match the code. The detail text changes for kiln_core and toxin_splitter only, and both are given in descKo.

## 분석: clockwork+familiars+starter (검증 전)

정상 판정 8개: 째깍 폭탄 꾸러미(tick_bomb), 심연의 모래시계(abyssal_hourglass), 불씨 심장(ember_heart), 작은 달(moon_satellite), 겨울을 품은 구슬(winter_orb), 거울 파편(mirror_shard), 쌍둥이 그림자(twin_shadow), 품 안의 태양(lantern_sun)

### 금 간 모래시계 (cracked_hourglass) — 일반, 너무 강함, 확신 high
- 파일: src/content/items/clockwork.ts
- 실제 동작: stats: fireRate +0.4×power. This is additive, outside the pooled knee, and worth +15.4% of the 2.6 base. Range ×0.9^power (Math.pow, on a penalty). onRoomEnter in an uncleared room arms a timer; 0.5 s later onUpdate slows every vulnerable enemy for 2 s (+0.5 s per extra copy) at 40% (bosses capped at 30% by Enemy.applyStatus), with RingFx, particles and proc(). Works on every weapon kind; charge weapons gain through chargeTime(), which scales with weaponStats.fireRate. Co-op: per-keeper vars, and the slow hits all enemies.
- 측정: Audit late 1.23/1.21/1.20 (lantern/nail/blade). Re-measured with a fixed late-base cache (see crossCutting): with tag 1.215/1.200/1.197. Tagless, i.e. own value without the clockwork-II completion it triggers in 6/8 late builds: 1.150/1.115/1.092. Alone: lantern 1.19, nail 1.145, void 1.145, blade 1.109, gatling 1.152. Lantern reads high because its frame-quantized cooldown makes +0.4 = 20 vs 24 frames. x3 1.54, about linear (1.57). Variant fireRate +0.3: tagless 1.107/1.091/1.069, with tag 1.202/1.193/1.171. Variant +0.25: tagless 1.088/1.072/1.065.
- 문제:
  - Own value is above the common band (1.04–1.12) on lantern and nail; clockwork-II completion adds another +0.05–0.1 on top.
  - It has the same +0.4 fire rate as quick_feather, which has no drawback.
  - Range uses Math.pow(0.9, power). Harmless for a penalty (gentler than linear), but it breaks the letter of the copy rule.
- 제안: clockwork.ts L52: m.addStat('fireRate', 0.3 * power). Keep the range -10% and the room-start slow. Optional, for the copy rule: m.mulStat('range', Math.max(0.6, 1 - 0.1 * power)).
- 새 설명: 공격 속도 +0.3, 사거리 -10%. 전투 시작 시 적 둔화
- 기대 결과: Tagless late ≈1.11/1.09/1.07. With tag ≈1.20/1.19/1.17 while clockwork II is unchanged. x3 ≈1.39 on lantern.

### 태엽 열쇠 (wind_up_key) — 일반, 수정 필요, 확신 medium
- 파일: src/content/items/clockwork.ts
- 실제 동작: grantPerCopy gives +2 keys per copy (purse is shared by the party in co-op, cap 99). stats: damage + min(3, keys×0.25)×power. This is flat additive damage outside the pool: +0.25 per key held, up to +3 at 12 keys, linear across copies. onUpdate uses watch(min(12, keys)) to recompute stats when the key count changes. It never calls proc(), so its HUD row never flashes.
- 측정: Audit late 1.12/1.16/1.15. Fixed harness: with tag 1.145/1.146/1.149, tagless 1.047/1.047/1.047. The harness holds only the 2 granted keys (+0.5 damage), so about +0.1 of the late number is clockwork-II completion. Alone 1.05 on all weapons, x3 1.15 (linear).
- 문제:
  - Real value scales with key hoarding: 4 keys = +1 (about +9%); 12 keys = +3 (about +27% of base damage), above the common band. Keys can be bought with coins.
  - No proc() feedback when the bonus changes.
- 제안: clockwork.ts L103: m.addStat('damage', Math.min(2, keys * 0.2) * power). L111: watch(w, 'wind_up_key', Math.min(10, w.player.keys)). Also in onUpdate: when the watched key count goes up, call proc(w, 'wind_up_key', true).
- 새 설명: 열쇠 +2. 가진 열쇠 1개당 공격력 +0.2 (최대 +2)
- 기대 결과: Tagless: 2 keys ≈1.04, 5 keys ≈1.09, cap (10 keys) ≈1.17. x3 linear.

### 녹슨 못 (rusted_nail) — 일반, 너무 강함, 확신 medium
- 파일: src/content/items/clockwork.ts
- 실제 동작: modifyHit fires on real attack hits (isAttack: weapon shots, item and familiar shots, melee, beam ticks) against a target that is not already weak. It rolls rollHit at 15% × hitShare (copies 1-(1-p)^n, +luck) and on success applies weak for 4 s via addHitStatus (primary hits only; bosses included; 0.5 s per-target and 0.2 s per-effect throttle). Weak is implemented in Enemy.takeHit as dmg×1.25 on ALL damage (DoTs, releases, items). It is a separate multiplier outside the HitInfo.amp pool and its softBonus knee.
- 측정: Audit late 1.156/1.148/1.147. This is understated by the audit cache bug: rusted_nail is in 4 of the 8 late builds. Fixed harness: with tag 1.274/1.236/1.252, tagless 1.143/1.148/1.158. Alone: lantern 1.125, nail 1.156, void 1.167, blade 1.195, gatling 1.242; x3 1.21. Chance/duration tweaks barely help because late builds land enough hits to keep weak up almost permanently: 0.1 chance/3 s gives 1.27/1.22/1.18 with tag. Weak at +15% (status power 0.15): tagless 1.081/1.093/1.098, with tag 1.214/1.184/1.178. Weak at +12%: tagless 1.062/1.077/1.081.
- 문제:
  - Near-permanent +25% damage-taken on any target, including bosses, at common rarity. It bypasses the amp knee and sits above the common band even without the set.
  - Lowering the chance or duration does not move late builds; only the magnitude does.
- 제안: Give weak a magnitude. In src/game/enemy.ts L196 replace the fixed ×1.25 with: const wk = this.statuses.get('weak'); if (wk) dmg *= 1 + (wk.power > 0 ? wk.power : 0.25). This is backward compatible. Also make blades.ts L370 pass power: 0.25 explicitly, because applyStatus merges power with max. Then rusted_nail: addHitStatus(w, t, hit, { kind: 'weak', duration: 4, power: 0.15 }). Fallback with no core change: drop the status, keep an enemy mem timer (t.mem.__rustT), and amplify(hit, 0.15) while it runs. That goes through the knee but loses the weak tint.
- 새 설명: 공격이 15% 확률로 적을 약화시킨다 (받는 피해 +15%)
- 기대 결과: Tagless late ≈1.08/1.09/1.10. With tag ≈1.21/1.18/1.18 while clockwork II is unchanged. x3 ≈1.13.

### 톱니 포탑 (gear_turret) — 희귀, 고장, 확신 medium
- 파일: src/content/items/clockwork.ts (+ GearTurret in familiars.ts)
- 실제 동작: Spawns min(3, power) GearTurret followers. Each fires every 0.85/min(2, 1+0.25(power-1)) s at the nearest enemy within 170 px: a gen-1 projectile for 0.55 × keeper damage (p.stats), speed 260, range 190. Shots count as attacks, so they roll per-hit procs at hitShare 0.55 but cause no spawn procs. All turrets share one 0.2 s effect throttle ('familiar:gear_turret'). sfx and muzzle particles play after shoot() whether or not the shot actually spawned.
- 측정: Audit late 1.231/1.210/1.229. Fixed: with tag 1.231/1.241/1.247, tagless 1.140/1.157/1.130 (inside the rare band). Alone: lantern 1.31, nail 1.214, void 1.206, blade 1.184, bow 1.375. x3 1.44. Probe on lantern over 8 s: 1 copy 9 shots tried / 9 spawned; 2 copies 22 tried / 11 spawned; 3 copies 42 tried / 14 spawned. Damage 0.40 variant: with tag 1.182/1.195/1.202. Cadence 1.15 s variant: 1.197/1.223/1.186.
- 문제:
  - All turrets spawn with cd 0.5 and the same cadence, so they fire on the same frame. The shared 0.2 s throttle then drops every duplicate shot while its sfx and muzzle flash still play. The 2nd and 3rd turrets are mostly fake: 2 copies ≈1.25× one turret, 3 copies ≈1.5×.
  - On paper the per-copy cadence formula is superlinear (total output 1, 2.5, 4.5×); only the throttle hides it.
  - One copy's own value is fine; the quick-table excess comes from clockwork II.
  - No HUD flash: familiar actions run outside item hooks, so autoProc does nothing.
- 제안: In familiars.ts GearTurret: drop the cadence bonus (this.cd = 0.85 after each shot). Stagger by slot on the first update: if (this.age === 0) this.cd = 0.5 + this.slot * 0.3. Scale each shot so total output follows stackMul: damage: dmgOf(w) * 0.55 * stackMul(this.power) / this.count (1 / 1.6 / 2.0× one turret, below linear). Play sfx and muzzle only when the shot is alive: const s = this.shoot(...); if (!s.dead) { ... }. One copy is unchanged.
- 기대 결과: One copy unchanged (tagless late ≈1.14/1.16/1.13). Lantern alone ≈1.50 with 2 copies and ≈1.62 with 3 (now 1.38/1.44), still below linear (1.93), and every visible shot is real.

### 진자 추 (pendulum_weight) — 희귀, 너무 강함, 확신 high
- 파일: src/content/items/clockwork.ts (+ boomerangBehavior in lib.ts)
- 실제 동작: stats: knockback ×1.3. onShoot: generation-0 weapon shots without an onExpire payload and not lances get boomerangBehavior. On the first hit, a wall, or the slow-down at 60% range, the shot turns: damage ×BOOMERANG_RETURN (0.35), generation set to 1 (no spawn procs, but per-hit modifyHit procs still roll), hitIds cleared, pierce +99, range +900, spectral. Because hitIds is cleared while the shot still overlaps the struck enemy, the 'return' hit actually lands on the next frame at the impact point; the shot then flies back through everything. Extra copies do nothing (x3 = x1). Melee and beam weapons get only the knockback.
- 측정: Audit late 1.377/1.352/1.10, crowd 2.19, x3 1.47. Fixed: with tag 1.377/1.352/1.074, tagless 1.342/1.254/1.000. Alone: lantern 1.47, nail 1.32, gatling 1.37, blunderbuss 1.22, bow 1.20, void 1.00, blade 1.00. Alone values carry about ±0.1 crit noise; a 6 s lantern probe gave 1.33. Return-share variants, as tagless late / crowd: R 0.2 → 1.229/1.124/1.00, 1.71; R 0.18 → 1.214/1.106/1.00, 1.65; R 0.15 → 1.189/1.079/1.00, 1.55.
- 문제:
  - Biggest rare outlier: +25–34% own value on ranged weapons, against a rare band of 1.08–1.16.
  - Crowd 2.19 exceeds the rare soft cap of 1.8: the returning shot pierces 99 through a whole pack.
  - The 'return' hit is guaranteed at impact rather than on the way back.
  - Never calls proc(). Melee and beam get no value (no penalty, so acceptable).
- 제안: lib.ts L444: BOOMERANG_RETURN 0.35 → 0.15. Only pendulum uses it; tests/artifact-rework.test.ts reads the constant, so it stays valid. Optional feel fix: in turn(), keep the struck target id in hitIds (p.mem.boomHold) until the shot has turned more than π/2, then delete it, so the second hit really happens on the way back. Add an onTurn callback to boomerangBehavior that calls proc(w, 'pendulum_weight', true).
- 새 설명: desc unchanged; detail: '첫 적중 또는 벽에서 귀환. 같은 적은 왕복 각 1회, 귀환 피해 15%. 귀환탄은 추가 효과를 발동하지 않는다. 광휘의 창 제외.'
- 기대 결과: Tagless late ≈1.19/1.08/1.00; with tag ≈1.21/1.19/1.07. Crowd ≈1.55. x3 stays equal to x1.

### 작은 혼천의 (armillary) — 에픽, 수정 필요, 확신 medium
- 파일: src/content/items/clockwork.ts
- 실제 동작: onAttack counts attacks; every 3rd attack triggers (every 2nd at 2+ copies). Ranged and charge weapons: every gen-0 shot of that attack gets amplifyShot +0.5, orbits the keeper for 1.2 s at radius 20, then launches at the nearest enemy (speed ≥220). Melee: spawns an extra gen-1 star shot for 0.75 × keeper damage that orbits 1.2 s and then launches. Beam: onAttack fires every fire-rate interval, but nothing happens (beams never call onShoot and are not melee), so it is a no-op.
- 측정: Audit late 1.123/1.174/1.249. Fixed: with tag 1.147/1.174/1.258, tagless 1.075/1.071/1.161. Alone: lantern 1.075, nail 1.113, blade 1.232, void 1.000, gatling 1.044, bow 0.93–0.96. x3 1.10. Variants (tagless): melee/beam shot at 0.6 → blade 1.138, void alone 1.153. Adding ranged amp 0.75 → 1.133/1.119/1.168 tagless, 1.210/1.234/1.268 with tag.
- 문제:
  - Beam weapons get nothing from an epic.
  - The melee star shot is worth far more than the ranged bonus: blade 1.16 own vs ranged 1.07.
  - Ranged own value (+7%) is below even the common band; the 1.2 s orbit eats most of it.
  - Every 3rd charged bow arrow is held 1.2 s in orbit (alone 0.93–0.96 in the 8 s window): a feel cost on charge weapons.
- 제안: (a) Star shot dmg(w)*0.75 → dmg(w)*0.6, and extend that branch to beams: if (w.vars.__armOn >= 0 && (isMelee(w) \|\| Weapons.get(w.player.weaponId)?.kind === 'beam')). (b) Only if clockwork II is trimmed: ranged amplifyShot(p, 0.5) → 0.75. This is a justified buff: own +7% on ranged is too weak for an epic. (c) Optional: charge weapons orbit 0.5 s instead of 1.2 s.
- 새 설명: desc unchanged; detail: '무기 탄환에 적용. 근접·광선은 회전탄(공격력의 60%)을 추가 발사. 2개 이상이면 2번째마다.'
- 기대 결과: With (a): blade tagless ≈1.14, with tag ≈1.235; void alone ≈1.15 (from 1.00); ranged unchanged. With (a)+(b): ranged tagless ≈1.13/1.12, with tag ≈1.21/1.23.

### 메트로놈 심장 (metronome_heart) — 에픽, 너무 강함, 확신 high
- 파일: src/content/items/clockwork.ts
- 실제 동작: stats: when at least 3 s have passed since the keeper's lastHurtAt, fireRate ×(1 + 0.25×power) is added to the pooled bonus (linear across copies, softBonus knee applies). onUpdate uses watch() to recompute on toggle; on activation it shouts '템포!', calls proc(), plays sfx and spawns beat particles. Per keeper in co-op. The harness runs in god mode, so it measures 100% uptime (an upper bound).
- 측정: Audit late 1.338/1.280/1.225. Fixed: with tag 1.305/1.280/1.273, tagless 1.231/1.199/1.172. Alone: lantern 1.29, nail 1.233, void 1.227, blade 1.219, gatling 1.267. x3 1.78 (linear). +20% variant: tagless 1.188/1.160/1.118, with tag 1.235/1.277/1.209. +15% variant (with tag): 1.189/1.186/1.173.
- 문제:
  - At full uptime its own value sits at or above the epic top (lantern 1.23).
  - Skilled play and clean boss fights keep uptime near 100%, and clockwork II stacks on top.
- 제안: clockwork.ts L380: m.mulStat('fireRate', 1 + 0.2 * power).
- 새 설명: 3초 동안 피격당하지 않으면 공격 속도 +20%
- 기대 결과: Tagless ≈1.19/1.16/1.12 at full uptime; with tag ≈1.24/1.24/1.21; x3 ≈1.64.

### 긴 심지 (long_wick) — 일반, 너무 강함, 확신 high
- 파일: src/content/items/starter.ts
- 실제 동작: stats: damage +1.5×power (flat, outside the pool = +15% of base 10). onAttack counter (shared across copies), every 5th attack: ranged and charge → that attack's gen-0 shots get amplifyShot +0.4, scale ×1.45, radius ×1.25, proc(); melee → throws an extra gen-1 flame for 0.9 × keeper damage, range 95 (needs live enemies; gated by effectProc). Beam: only the flat damage, because beams never call onShoot.
- 측정: Audit late 1.197/1.203/1.231. Fixed 1.212/1.215/1.231; tagless is the same, so the flame set adds about 0. Alone: lantern 1.24, nail 1.23, void 1.15, blade 1.29, gatling 1.16. x3 1.57 (sublinear). Variants (late): +0.6 damage with melee flame 0.5 → 1.120/1.123/1.108; +0.5 → 1.110/1.112/1.098; +0.7 with a +30% 5th shot → 1.115/1.117/1.116.
- 문제:
  - Own value is +21–23% at common rarity (band 1.04–1.12).
  - The melee flame (0.9× every 5th swing, about +18%) is worth roughly twice the ranged +40% on one shot.
  - Beams never get the 5th-attack signature.
- 제안: starter.ts L34: m.addStat('damage', 0.5 * power). L45: melee flame pl.stats.damage * 0.5. Let beams throw the same flame: if (w.vars.__wickOn < 0 \|\| !(isMelee(w) \|\| Weapons.get(w.player.weaponId)?.kind === 'beam')) return. Keep the +40% big-flame signature.
- 새 설명: 공격력 +0.5. 5번째 공격마다 큰 불꽃탄
- 기대 결과: Late ≈1.11/1.11/1.10. Alone lantern ≈1.13. x3 ≈1.24.

### 재빠른 깃털 (quick_feather) — 일반, 너무 강함, 확신 medium
- 파일: src/content/items/starter.ts
- 실제 동작: stats: moveSpeed ×(1+0.12×power), fireRate +0.4×power (additive). onDash opens a 1.5 s window. The next attack (enemies present, effectProc) throws 2 homing (3.5) gen-1 feathers, each (0.35+0.1×power) × keeper damage, i.e. 0.9× keeper damage per dash at 1 copy. Works with every weapon kind.
- 측정: Audit late 1.157/1.158/1.091; the audit never dashes, so the feathers are invisible to it. Fixed 1.141/1.136/1.057 (the storm set adds about 0). With a dash every 2.5 s: late 1.220/1.180/1.261, alone lantern 1.325. Variants as late no-dash / late with a dash every 2.5 s: fireRate 0.25 + feather 0.25+0.1p → 1.102/1.041/0.994 / 1.148/1.090/1.182; fireRate 0.2 + feather 0.3+0.1p → 1.085/1.036/0.986 / 1.156/1.089/1.188.
- 문제:
  - Same +0.4 fire rate as cracked_hourglass with no drawback, plus move speed.
  - The feather volley adds about +8–20% for keepers who dash in combat; the audit cannot see it.
- 제안: starter.ts L122: m.addStat('fireRate', 0.25 * power). L135: damage pl.stats.damage * (0.25 + 0.1 * power).
- 새 설명: 이속 +12%, 공속 +0.25. 대시 후 깃털탄 2발
- 기대 결과: No-dash late ≈1.10/1.04/0.99 (the blade gain is hidden by swing-frame quantization). With a dash every 2.5 s ≈1.15/1.09/1.18. x3 ≈1.39.

### 구전 정령 (ball_lightning) — 희귀, 수정 필요, 확신 medium
- 파일: src/content/items/storm.ts (+ BallLightning in familiars.ts)
- 실제 동작: Spawns min(3, power) BallLightning familiars drifting about 20 px around the keeper (drift phase from w.rng). Each fires every 1.35/min(2, 1+0.25(power-1)) s at the nearest enemy within 115 px: chainLightning with 2 jumps, 0.85 × keeper damage, ×0.85 per jump (itemHit: crits allowed, noProc). Storm-V resonance adds jumps and a stun. All balls share one 0.2 s throttle.
- 측정: Audit late 1.185/1.144/1.126. Fixed: with tag 1.185/1.144/1.117, tagless 1.149/1.117/1.116 (inside the rare band). Alone: lantern 1.335, nail 1.228, void 1.213, blade 1.272. Crowd 1.55 (≤1.8). x3 1.41. 0.70× variant: 1.155/1.116/1.098.
- 문제:
  - Same lock-step as gear_turret: every ball starts at cd 0.8 with the same cadence, so they zap on the same frame. The shared throttle makes chainLightning return 0 after cd was already reset, so 2–3 copies give only about 1.1–1.25× one ball.
  - The per-copy cadence formula is superlinear on paper.
  - One copy's value is fine. No HUD flash.
- 제안: In familiars.ts BallLightning: stagger on the first update with if (this.age === 0) this.cd = 0.8 + this.slot * 0.35. Use a fixed cadence (this.cd = 1.35 after each zap). Damage: dmgOf(w) * 0.85 * stackMul(this.power) / this.count, so totals are 1 / 1.6 / 2.0× one ball. One copy is unchanged.
- 기대 결과: One copy unchanged (tagless late ≈1.15/1.12/1.12). x3 on lantern alone ≈1.67 (from 1.41), still below linear (2.0).

<details><summary>정상 판정 유물의 근거</summary>

- **째깍 폭탄 꾸러미 (tick_bomb)**: +3 bombs per copy (grantPerCopy). onBomb: RingFx radius 70 (+10 per copy) and a 1.2 s stun (+0.3 s per copy) on enemies inside. On bosses, bossSafe cuts the stun to ≤0.25 s and Enemy.applyStatus adds a 2 s control lockout. Proc feedback comes through inflict→procHere inside the hook. 측정: Alone, crowd and x3 all 1.00 (the harness never bombs). Late with tag 1.050/1.093/1.096 vs tagless 1.000: its whole late number is clockwork-II completion.
- **심연의 모래시계 (abyssal_hourglass)**: Unique. stats: fireRate +0.5 (additive, +19% of base). onHurt, if the keeper is alive and the 6 s cooldown is ready: timeStop 3 s, which sets w.enemyTimeScale to 0.04 for enemies and enemy bullets (the keeper is unaffected), plus a screen wash and shout. tickTimeStop runs every update and on room enter; onRemove ends a running stop. draw() renders a cosmetic hourglass using fx. 측정: Audit late 1.231/1.249/1.230. Fixed: with tag 1.231/1.240/1.230, tagless 1.161/1.150/1.130. Alone: lantern 1.24, nail 1.145, blade 1.141. The time stop is never measured because the harness runs in god mode.
- **불씨 심장 (ember_heart)**: stats: maxHearts +1 per copy (one red container). onFloorStart: if red < max, heal(power), i.e. half a heart per copy (heal units are half hearts), with particles and proc(). Per keeper in co-op. 측정: DPS-neutral (1.00 everywhere).
- **작은 달 (moon_satellite)**: Spawns min(3, power) moons orbiting at radius 21 and 2.8 rad/s. Each blocks enemy bullets within 5.5 px and deals contact damage of 0.7 × keeper damage, at most once per 0.3 s per enemy (itemHit). Extra copies only add moons. 측정: Fixed late 1.000/1.000/1.039; the audit's 1.02/1.06/1.16 is skewed by the cache bug (moon is in 2 late builds). Alone 1.00 on ranged, 1.127 on blade. Crowd 1.31. x3 1.00 on ranged.
- **겨울을 품은 구슬 (winter_orb)**: Spawns min(3, power) orbs at radius 29, counter-rotating at -2.1 rad/s. Each blocks bullets within 5.5 px; contact deals 0.45 × keeper damage at most every 0.4 s plus a 50% slow for 2 s; each contact has a 20% chance (w.rng) to freeze for 1.1 s. Bosses get a slow instead of freeze; frozen enemies take ×1.2 damage. 측정: Fixed late 1.047/1.028/1.011 (audit 1.055/1.046/1.042). Alone 1.04–1.16. Crowd 1.27. x3 1.34 (about linear).
- **거울 파편 (mirror_shard)**: Spawns min(2, power) shards orbiting at radius 16 and 4.2 rad/s. Each blocks bullets within 5 px. Every blocked bullet becomes a homing (3) reflect shot of 0.9 × keeper damage toward the nearest enemy within 220 px, at speed max(220, 1.6× the bullet), subject to the shared 0.2 s throttle. 측정: DPS-neutral (the dummies never shoot).
- **쌍둥이 그림자 (twin_shadow)**: Spawns min(2, power) shadows trailing 0.16 s (+0.1 s per slot) behind the keeper. onAttack, gated by cooldown 1/max(0.5, keeper fireRate), each shadow mimics the attack. Ranged: a shot for 0.35 × keeper damage using the keeper's shotSpeed and projSize, range ×0.9. Melee: a slash projectile for 0.35×, pierce 6, range 48. Shadow shots are attacks, so they roll per-hit procs at hitShare 0.35. 측정: Fixed late 1.223/1.167/1.101 (tagless is the same). Alone: lantern 1.375, nail 1.242, void 1.153, blade 1.153. Crowd 1.37. x3 1.73 (2 shadows, about linear). 0.30 variant: 1.196/1.142/1.083.
- **품 안의 태양 (lantern_sun)**: Unique. The sun orbits at radius 36 and 1.45 rad/s and blocks bullets within 10 px. Contact deals 1.1 × keeper damage at most every 0.35 s per enemy, plus a 3 s burn at 0.5 × damage/s. Every 0.5 s its aura hits enemies within 26 px of the sun for 0.25 × damage plus a 2 s burn at 0.4 × damage/s. Spawns min(2, power) suns. 측정: Late with tag 1.202/1.197/1.187, tagless 1.202/1.160/1.134. Alone 1.29–1.42. Crowd 2.38. x3 1.77 (not reachable: the item is unique).

</details>

분석가가 본 계열 밖의 문제:
- AUDIT HARNESS BUG (tests/item-audit.test.ts, artifacts mode): the lateBase cache key is `${wid}\|${i}` and ignores the actual 10-item base `b`. When the artifact is itself in build i (b = b0 minus it, plus the 11th item), or when the first artifact processed in a shard was in build i, the ratio is taken against a different base, sometimes one that already contains the artifact. All onLate numbers are noisy, and items that appear in many late builds are understated: rusted_nail (in 4/8 builds) reads 1.156/1.148/1.147 but is really 1.274/1.236/1.252. Fix: key the cache by `${wid}\|${i}\|${b.join(',')}`.
- Clockwork resonance II ('5번째 공격마다 반드시 치명타', resonance.ts) completes in 6 of the 8 late builds, because each holds exactly one clockwork item. It adds about +0.05–0.11 to every clockwork artifact's late value. tick_bomb has no DPS of its own yet reads 1.05/1.09/1.10. Tagless vs tagged: cracked 1.15→1.215, metronome 1.23→1.31, gear_turret 1.14→1.23, rusted 1.14→1.27, abyssal 1.16→1.23. In the same test other II tiers add about 0–0.05 (flame ≈0, storm ≈+0.03, star ≈+0.04). Clockwork II looks like the strongest 2-piece tier; consider every 7th attack. Several clockwork outliers in the quick table are this set, not the artifacts themselves.
- Familiar lock-step: familiars of one artifact spawn with the same cd and cadence, so they act on the same frame. The shared 0.2 s effectProc throttle ('familiar:<id>') then drops all but one action, while GearTurret still plays sfx and muzzle particles. Probe: gear_turret ×2 gave 22 tries / 11 shots, ×3 gave 42 / 14. Affects gear_turret and ball_lightning; stagger the initial cd by slot. Their per-copy cadence formulas `/ Math.min(2, 1 + (power - 1) * 0.25)` are superlinear on paper.
- Familiars never flash their artifact's HUD row. Familiar.update runs inside withProcContext (throttle only), not inside an item hook, so procHere/autoProc does nothing. Familiar.shoot/contact/blockBullets could call proc(w, procEffect.slice('familiar:'.length), true). Affects gear_turret, ball_lightning, moon_satellite, winter_orb, mirror_shard, lantern_sun and twin_shadow's shots. pendulum_weight and wind_up_key also never call proc().
- The weak status (Enemy.takeHit ×1.25) and freeze (×1.2) multiply outside the HitInfo.amp pool and its softBonus knee. Adding weak power through StatusApply.power is the smallest lever (see rusted_nail). blades.ts L370 should then pass power 0.25 explicitly, because applyStatus merges power with max.
- Weapon cadence quantization: weapons that set `st.cooldown = 1 / fireRate` and fire when ≤0 lose up to one frame per attack (lantern 2.6/s plays as 2.5/s; +0.4 → 3.0/s = +20%; +0.3 → 2.86/s). Additive fireRate items therefore measure in steps; e.g. blade with +0.25 reads 1.000 alone. Accumulating (`st.cooldown += 1/rate`) would make them smooth and the audit less noisy.
- Harness limits: RELEASE_WEAPONS (hunter_bow) use a fixed 1.1 s hold/release cycle, so every fireRate item reads 1.000 on hunter_bow, although chargeTime() does scale with weaponStats.fireRate in game. God mode keeps metronome_heart always on and abyssal_hourglass's stop never fires. Alone values carry about ±0.1 crit noise (≈20 shots × 5% crit): pendulum on lantern reads 1.47 over 8 s but 1.33 over 6 s. The audit never dashes, so quick_feather's feathers go unmeasured.
- Additive damage and fireRate bonuses (long_wick, wind_up_key, cracked_hourglass, quick_feather, abyssal_hourglass) bypass the pooled knee and compound with the pool multiplier. That is fine at the proposed sizes, but worth noting next to POOLED_STATS.

메모: familiars.ts defines no artifacts, so I covered the artifacts whose behaviour lives there. Their defineArtifact calls are in other files: storm.ts (ball_lightning), star.ts (moon_satellite, lantern_sun), frost.ts (winter_orb), trinkets.ts (mirror_shard) and shadow.ts (twin_shadow). Dedupe with those analysts. How I measured: my own scratch harness, with the same 8 late builds ('AUDIT-ART-LATE', 8×11), weapons, seeds and near/far max as the audit, but the late-base cache keyed by the real base build. Variants were registered as hidden test-only artifacts. "Tagless" means the same artifact with tags: [], which separates the artifact's own value from the resonance completion it triggers. I judged each artifact on its own value and reported the clockwork-II inflation separately. Proposals by priority: 1. pendulum_weight: return share 0.35 → 0.15. 2. long_wick: +1.5 → +0.5 damage, melee/beam flame 0.5. 3. rusted_nail: weak +15% via status power. Needs a small, backward-compatible change in enemy.ts. 4. quick_feather: fire rate 0.4 → 0.25, feathers 0.25+0.1p. 5. cracked_hourglass: fire rate 0.4 → 0.3. 6. metronome_heart: 25% → 20%. 7. wind_up_key: 0.2 per key, max +2. 8. armillary: star shot 0.6 and include beams. Raise the ranged bonus to 0.75 only if clockwork II is trimmed. 9. gear_turret and ball_lightning: fix the lock-step; single-copy values are in band. Unchanged: tick_bomb, abyssal_hourglass, ember_heart, moon_satellite, winter_orb, mirror_shard, twin_shadow, lantern_sun. I made no edits under src/ or tests/. My scratch tests (tests/_scratch_cwk_*) are deleted. The tests/_scratch_fbv_* files belong to another agent and were left alone.

## 분석: shadow+storm+frost (검증 전)

정상 판정 9개: 연기 베일(smoke_veil), 쌍둥이 그림자(twin_shadow), 구리 코일(copper_coil), 천둥 북(thunder_drum), 서리 조각(rime_shard), 동상 반지(frostbite_ring), 빙정 나선(crystal_spiral), 빙하 렌즈(glacier_lens), 상고대 망토(hoarfrost_mantle)

### 밤의 덧신 (night_slippers) — 일반, 너무 강함, 확신 medium
- 파일: src/content/items/shadow.ts
- 실제 동작: stats: dashCooldown x Math.pow(0.75, power) (compounds), moveSpeed x(1+0.08p). onDash: p.invuln = max(invuln, dashTime + 0.22), where a plain dash gives dashTime + iframes (0.06 default), so +0.16 s. Dash cooldown starts at dash start (Player.tryDash). Afterimages are cosmetic.
- 측정: Damage-neutral (1.00). Invulnerable share of time when spamming dash = (dashTime + iframes) / dashCooldown: - Plain keeper (cd .85, dt .15): base 25 % -> 58 % with slippers. - Ria (cd .72): 29 % -> 69 %. - Mori (cd .50, dt .10, if .08): 36 % -> 85 %. - Two copies on Ria: 91 %. - Slippers + static_cape: the cape carries the shadow tag, so these two commons alone light 그림자 II (-15 %). Ria then reaches 88 % and Mori 91 % (cd hits the 0.35 floor while invuln is 0.32).
- 문제:
  - A common that turns dash spam into near-permanent invulnerability (69-91 % uptime), more than any rare defensive item gives.
  - Copies stack with Math.pow(0.75, power) (rule: linear or stackMul). The blessing in blessings.ts:69 uses the same Math.pow.
- 제안: shadow.ts night_slippers: - stats: m.mulStat('dashCooldown', 1 / (1 + 0.25 * power)) — 1 copy -20 %, linear rate gain. - stats: keep moveSpeed. - onDash: p.invuln = Math.max(p.invuln, p.stats.dashTime + 0.16) — +0.10 s over the default i-frames instead of +0.16 s.
- 새 설명: 대시 쿨다운 -20%, 이속 +8%. 대시 무적 0.1초 연장
- 기대 결과: Invulnerable share when spamming dash: - Plain keeper: 46 % (was 58 %). - Ria: 54 % (was 69 %). - Mori: 65 % (was 85 %). - Ria with 2 copies: 65 % (was 91 %). - Ria + static_cape + 그림자 II: 69 % (was 88 %). - Mori + static_cape + 그림자 II: 74 % (was 91 %). Damage unchanged (1.00).

### 검은 초 (black_candle) — 일반, 너무 강함, 확신 medium
- 파일: src/content/items/shadow.ts
- 실제 동작: stats: damage +1.5 x power (flat, so +15 % on base 10 for both keeper and weapon), luck -1 x power. Luck lowers ember gain 2 %, the enemy drop chance (6 % -> 5 %) and loot luck; negative luck never lowers proc chance (only positive luck counts). onKill (non-minion): roll 10 % -> miniBlast r30 for 0.8 x keeper damage plus 2 s fear (bosses immune to fear).
- 측정: Exactly 1.15 alone on all 8 weapons and in crowds (deterministic flat add); x3 1.45, linear. Corrected late (fresh base per build) 1.15/1.15/1.15; the audit's 1.146/1.107/1.146 is distorted by the late-cache bug (see crossCutting).
- 문제:
  - Unconditional +15 % on every weapon and target: above the common band top (1.12). The luck penalty is mild.
- 제안: shadow.ts black_candle stats: m.addStat('damage', 1.2 * power) (was 1.5). tests/presence.test.ts 'common stat artifacts are noticeable (>= +15%)' then needs black_candle to use the 1.12 threshold, like the leech_tooth exception.
- 새 설명: 공격력 +1.2, 행운 -1. 처치 시 가끔 검은 불꽃
- 기대 결과: alone/late 1.12 on every weapon, x3 1.36, crowd about 1.12 (plus kill blasts)

### 등 뒤의 눈 (rear_eye) — 일반, 수정 필요, 확신 high
- 파일: src/content/items/shadow.ts
- 실제 동작: onAttack, if any enemy is alive, gated to the keeper's cadence (cooldown 0.9/keeperFR) plus effectProc: - melee: p.swing toward angle+PI, 0.6 x keeper damage, arc 1.8, noProc. - ranged: p.fireProjectiles(back, fromWeapon:false, count: power, 0.7 x keeper damage each, generation 1). Copies stack linearly on ranged; melee ignores power. No proc() call, and onAttack is not an auto-proc hook, so there is no HUD flash.
- 측정: Ranged: 1.00 everywhere (the dummy is in front). sentinel_blade: - audit: 1.32 alone, 1.205 late - my measure (8 seeds): 1.385 - boss-size dummy (r20): 1.42 - corrected late: 1.269 Cause: MeleeSwing.contains returns true for d < pr + 6 whatever the angle. A melee keeper hugging a target (always the case on a boss, pr 16-30) lands the 'rear' swing on the target in front.
- 문제:
  - On melee it is a free extra swing on the target in front: +27-42 % vs bosses for a common.
  - Fires even when nothing is behind.
  - No proc() presence.
  - Melee ignores copies.
- 제안: shadow.ts rear_eye onAttack: 1. Only act when an enemy is really behind. Let reach = isMelee(w) ? 44 : p.stats.range, and require    w.enemies.some(e => e.alive && e.vulnerable && !e.hidden && dist2(p.x,p.y,e.x,e.y) < (reach+e.r)^2 && Math.abs(angleDiff(angle+Math.PI, angleTo(p.x,p.y,e.x,e.y))) < 1.2)    Write the square as x*x, not **. Return early when no such enemy exists. 2. Keep the cadence gate and effectProc. 3. Call proc(w, 'rear_eye', true) when it fires. Damage numbers stay as they are.
- 새 설명: 등 뒤에 적이 있으면 공격할 때 뒤로도 약한 공격이 나간다
- 기대 결과: Measured with the patch: - Front-only target: 1.00 on every weapon (blade 1.385 -> 1.00; boss-size 1.42 -> 1.00). - Small crowd: blade 1.25, lantern 1.00. - Crowds with enemies behind keep the designed value (+70 % keeper damage per attack on the enemy behind, ranged).

### 그림자 단검 (shade_dagger) — 희귀, 너무 강함, 확신 medium
- 파일: src/content/items/shadow.ts
- 실제 동작: onDash opens a window of dashTime + 0.06 s. onUpdate: enemies within p.r+7 get itemHit 1.6 x keeper damage x stackMul(power), knockback 120, and a bleed of 3 s at 0.3 x damage per second (about 0.9 x damage total per stack). That is once per dash per enemy, and the same enemy at most every 2 s (e.mem.__dagCd). Calls proc() and sfx.
- 측정: Damage-neutral in the audit (the bot never dashes). Harness dash option, ratio vs the same dashing bot without the item: - dash every 2 s: lantern 1.288, blade 1.311, crowd 1.42; 2 copies 1.42. - dash every 1 s: 1.415 / 1.453, crowd 1.70.
- 문제:
  - About 2.5 x keeper damage per pass every 2 s on a boss: +29 % at a modest dash cadence. Rare band top is 1.16.
  - Co-op: e.mem.__dagCd is shared between keepers, so one keeper's cut blocks the other's.
  - e.mem gains a new __dag<n> key per dash per enemy; prefer e.mem.__dagLast = id.
- 제안: shadow.ts shade_dagger onUpdate: e.mem.__dagCd = w.time + 3 (was +2). Damage and bleed unchanged. Update the detail to '공격력의 160% 피해와 3초 출혈. 같은 적은 3초에 한 번만 벤다.' Optional cleanup: store e.mem.__dagLast = w.vars.__dagId instead of one key per dash.
- 기대 결과: Measured with the patch: - dash every 2 s: lantern 1.152, blade 1.175, crowd 1.30. - dash every 1 s: 1.303 / 1.321, crowd 1.44. - x2 stays sublinear (stackMul).

### 텅 빈 가면 (hollow_mask) — 희귀, 약함, 확신 low
- 파일: src/content/items/shadow.ts
- 실제 동작: modifyHit: - If the target is feared: amplify +0.2. This does not scale with power. - Otherwise, on an attack hit: rollHit 10 % (x hitShare, copies 1-(0.9)^n) -> addHitStatus fear 2.5 s. bossSafe drops fear on bosses, so the mask never applies its fear and never gets its bonus on any boss. Feared enemies run away from the keeper.
- 측정: 8 seeds, single target: - lantern 1.058, nail 1.056, blade 1.074, void 1.059 - bell 0.945 (x3: 0.76), bow 1.14, gatling 1.07 Crowd 1.05. x3 1.06 / 1.06 / 1.12; x3 crowd 1.10. Boss-size 1.03-1.06; real bosses exactly 1.00. Corrected late 0.967 / 0.929 / 0.991 (audit 1.006 / 0.929 / 1.058). The fleeing target escapes short-range weapons and player-centred effects.
- 문제:
  - Offensively net ≤ 1.0 in late builds and a no-op on every boss; its value is crowd control (2.5 s fear on regular enemies).
  - Fear's flee costs short-range builds damage (bell 0.945, x3 0.76). That is inherent to the fear verb, not a bug.
- 제안: Optional; skip it if this pass is strictly downward. Bosses shrug off fear, so give them a short 'dread' instead of nothing: in modifyHit, when the roll succeeds on a boss (t instanceof Enemy && t.isBoss), inside effectProc set t.mem.__dreadT = w.time + 2.5 and statusPuff(w, t, 'fear'). Amplify +0.2 when t.hasStatus('fear') \|\| (t.mem.__dreadT ?? 0) > w.time. No raw-number change.
- 새 설명: 10% 확률로 공포를 건다 (보스는 위축). 겁먹거나 위축된 적에게 피해 +20%
- 기대 결과: Bosses about 1.07-1.09 (about 40 % dread uptime on lantern); rooms unchanged; late about 1.0-1.03.

### 정전기 망토 (static_cape) — 일반, 수정 필요, 확신 medium
- 파일: src/content/items/storm.ts
- 실제 동작: stats: dashSpeed x(1+0.15p), dashCooldown x Math.pow(0.92, p). onDash: chainLightning from the keeper, jumps 1+power, 0.7 x keeper damage, range 75. The only gate is effectProc 0.2 s, so every dash zaps. Carries the shadow tag: it counts toward 그림자 II (dash cd -15 %).
- 측정: Damage-neutral in the audit (no dashes). Harness dash, vs the same dashing bot: - every 2 s: 1.088 / 1.098, crowd 1.167. - every 1 s: 1.27 / 1.27, crowd 1.50; x3 crowd 1.90. - Dash-spamming at the cape's own 0.78 s cd is worth about +34 % single target; with slippers + 그림자 II about +54 %.
- 문제:
  - No dash-spam guard, while the 번개 III tier caps its identical dash zap at 1/s ('dash spam cannot turn it into a damage engine').
  - Math.pow on copies (dashCooldown).
- 제안: storm.ts static_cape: - onDash: keep the cosmetic burst, then   if (!effectInterval(w, 1)) return;   chainLightning(w, p.x, p.y - 6, { jumps: 1 + power, damage: dmg(w) * 0.6, range: 75 });   (import effectInterval from '../../game/procs'; the lazy claim only spends the 1 s when a target was hit). - stats: m.mulStat('dashCooldown', Math.max(0.6, 1 - 0.08 * power)). - Detail: '번개는 1초에 한 번, 공격력의 60% 피해로 (1+중복 수)명에게 튄다.'
- 기대 결과: Measured with a 1 s gate and 0.6: - dash every 2 s: 1.074 / 1.085, crowd 1.143. - dash every 1 s: 1.11 / 1.12, crowd 1.21 (the harness's exact 1 s cadence alternates with the gate). - Hard cap: about +20 % single target at ≥1 dash/s.

### 바람 접부채 (paper_fan) — 희귀, 수정 필요, 확신 medium
- 파일: src/content/items/storm.ts
- 실제 동작: stats: - shots +1+power (3 shots at 1 copy; multishotShare 0.6 each, 1.8 total if all connect) - damage x0.75 and fireRate x0.9: penalties, so they multiply, and they hit the keeper stats too (releases, familiars, procs) - spread x1.15 Applies whatever the weapon kind. Charge weapons ignore fireRate, so they skip part of the price.
- 측정: 8 seeds, small dummy: - lantern 0.82, nail 1.20, blade 0.78, void 0.69, bell 0.92, bow 1.39, gatling 1.22; crowd 1.26. Boss-size dummy (all shots connect): - lantern 1.26, nail 1.20, bow 1.39, gatling 1.21, bell 1.21. Corrected late: - lantern 0.833, nail 1.103, blade 0.748, bow 1.355, gatling 1.136, void 0.677, bell 0.883.
- 문제:
  - Fairness: melee and beam weapons pay x0.75 x0.9 for shots they never fire (blade 0.75, void 0.68).
  - Too strong vs big targets (bosses): +21-39 %, above the rare band; the bow skips the fireRate penalty.
  - Copies add shots while the penalty stays constant, so it is superlinear on big targets.
- 제안: storm.ts paper_fan stats(m, power, w):   const kind = Weapons.get(w?.player?.weaponId ?? '')?.kind;   if (kind === 'melee' \|\| kind === 'beam') return; // no volley to fan out: no shots, no price   m.addStat('shots', 1 + power);   m.mulStat('damage', 0.65 - 0.07 * (power - 1));   m.mulStat('spread', 1.15); This drops the fireRate x0.9, so charge and ranged weapons pay the same; import Weapons from game/defs. Weapon swaps already recompute stats (weaponslots.ts). Update tests/power-budget.test.ts: expect 1.25 * 0.65 instead of 1.25 * 0.75. Melee/beam weapons that read shots (resonance_bell, mirror_buckler, smoke_censer, prism_staff, thunder_rod, the sentinel finisher wave) lose the fan; no penalty either.
- 새 설명: 탄환 +2 (피해 분산). 공격력 -35%. 근접·광선 무기에는 효과 없음
- 기대 결과: Measured with the patch: - Big targets: 1.17-1.19 on every ranged/charge weapon. - Small dummy: lantern 0.77, nail 1.19, bow 1.19, gatling 1.15, bell 0.885; blade/void 1.00. - Crowd 1.17. - Late: lantern 0.79, nail 1.08, blade 1.00, bow 1.17. - x3 on big targets: lantern 1.32 / bow 1.41, below linear (1.51).

### 구전 정령 (ball_lightning) — 희귀, 수정 필요, 확신 high
- 파일: src/content/items/storm.ts
- 실제 동작: Familiars: min(3, power) spirits (BallLightning, familiars.ts). Each starts with cd 0.8 and zaps the nearest enemy within 115: chainLightning, 2 jumps, 0.85 x keeper damage. cd = 1.35 / min(2, 1+(power-1)·0.25). All spirits spawn with the same timer and rate, and share one proc key ('familiar:ball_lightning', 0.2 s). Every spirit after the first is blocked in the same step, so extra spirits never zap; copies only shorten the one effective timer.
- 측정: 6 seeds: - x1: 1.209 / 1.22 / 1.211, crowd 1.385; boss-size 1.21. - x2: 1.274; x3: 1.31 (crowd 1.50 / 1.62). These match the timer speed-up alone (1.25x / 1.5x). Corrected late 1.185 / 1.144 / 1.117.
- 문제:
  - Broken: the 2nd and 3rd spirits are decorative (their zaps are always throttled away).
  - Slightly above the rare band (alone 1.21, late lantern 1.185).
- 제안: familiars.ts BallLightning.update: 1. Spirits take turns at the same total rate:    const period = 1.35 * this.count / Math.min(2, 1 + (this.power - 1) * 0.25);    use it when a zap fires: this.cd = period. 2. Stagger them once: if (this.age <= dt) this.cd += this.slot * period / Math.max(1, this.count); (age is incremented first). 3. Zap damage dmgOf(w) * 0.75 (was 0.85). 4. Optional detail: '공격력의 75% 번개가 2명에게 튄다. 정령이 여럿이면 번갈아 친다.'
- 기대 결과: Measured with the patch: - x1: 1.182 / 1.195 / 1.185, crowd 1.337. - Late 1.165 / 1.125 / 1.105. - x2 1.24, x3 1.27 / 1.30 / 1.27 (crowd 1.44 / 1.55), still sublinear. - Every spirit now visibly zaps.

### 폭풍 부름 지팡이 (stormcaller_rod) — 에픽, 약함, 확신 medium
- 파일: src/content/items/storm.ts
- 실제 동작: stats: critChance +0.06 x power (linear, cap 0.6). onHit on a primary crit: chainLightning, jumps 3+power, 0.75 x keeper damage, range 100, excludes the crit target. Single target: only the +6 % crit (x1.8), about +4.8 % damage.
- 측정: 8 seeds: - single: 1.045 / 1.053 / 1.04 (void 1.03, bell 1.07, bow 1.06, gatling 1.04) - crowd: 1.328 lantern / 1.488 nail - x3: 1.17 / 1.14 / 1.18, crowd 1.99 / 2.00 Corrected late 1.085 / 1.049 / 1.078. The audit's crowd = 1.000 and lantern alone = 1.000 were rng luck: no draw fell in [0.05, 0.11) over about 21 shots.
- 문제:
  - Single-target value is common-level (late 1.05-1.085, epic band 1.12-1.22). AoE identity is fine (crowd 1.33-1.49, under the 2.0 cap).
- 제안: No change recommended in this downward pass. Only if epics must reach their band on bosses: in onHit, when chainLightning(...) returns 0 (nothing else in range), strike the crit target once with skyBolt(w, t as Enemy, dmg(w) * 0.5, 0). This keeps the crit -> lightning identity.
- 기대 결과: Unchanged. With the optional fallback, single target about 1.09-1.11; crowd unchanged.

### 폭풍의 심장 (tempest_heart) — 전설, 수정 필요, 확신 high
- 파일: src/content/items/storm.ts
- 실제 동작: stats: fireRate x1.2 (pooled, not scaled by copies). onHit on every primary hit, with no chance roll: chainLightning, 2 jumps, 0.45 x keeper damage x stackMul(power), range 80, excludes the target. The only limit is effectProc 0.2 s (5 chains/s). A weapon with many small hits gets the full keeper-damage chain on each, up to 5/s, regardless of hit size. That breaks the rollHit/hitShare rule. Cosmetic ZapFx uses fx.
- 측정: 8 seeds: - single: 1.193 / 1.128 / 1.231 (void 1.20, bell 1.21, bow 1.06, gatling 1.20) - crowd: lantern 2.19, nail 2.70, gatling 2.48, blade 1.40 (legendary crowd cap 2.3) - x3 1.24 Corrected late 1.198 / 1.16 / 1.124.
- 문제:
  - The per-hit proc is not weighted by hit size: many-hit weapons get about twice the AoE (nail crowd 2.70, gatling 2.48, above the 2.3 cap).
  - The detail repeats the boilerplate twice.
- 제안: storm.ts tempest_heart onHit: if (!isPrimary(hit) \|\| !rollHit(w, hit, 1, 1)) return; then the same chainLightning call. The chance becomes hitShare (capped 0.95), so chains follow damage dealt. Detail: '작은 타격일수록 번개가 튈 확률이 낮다. 처음 맞힌 적을 제외한 주변 적 2명에게 공격력의 45%. 최소 간격 0.2초.' Desc unchanged.
- 기대 결과: Measured with the patch: - crowd: lantern 2.157, nail 2.185, gatling 2.023, blade 1.414. - single unchanged (about 1.13-1.23). - late 1.235 / 1.13 / 1.131 (gatling 1.172). Legendary band 1.15-1.26 and crowd cap respected.

### 겨울을 품은 구슬 (winter_orb) — 희귀, 수정 필요, 확신 medium
- 파일: src/content/items/frost.ts
- 실제 동작: Familiars: min(3, power) orbitals (WinterOrb, familiars.ts) at radius 29, counter-rotating. Each: - blocks enemy bullets (r 5.5) - deals contact itemHit of 0.45 x keeper damage, each orb hitting a given enemy at most every 0.4 s, plus slow 2 s at 0.5 - on each contact, a 20 % w.rng chance to freeze 1.1 s (bosses get slow instead) Each orb has its own per-enemy cooldown, so copies add linearly.
- 측정: Small dummy: 1.06 / 1.07 / 1.05, crowd 1.20; x3 1.22 / 1.21 / 1.05, crowd 1.64. Boss-size dummy (r20): 1.15 / 1.16 / 1.32; x3 1.44 / 1.49 / 1.78. Corrected late 1.047 / 1.028 / 1.011. A melee keeper (or ranged at ~40 px) is in constant contact with a big boss, so each orb ticks 0.45 x damage every 0.4 s (1.1 x damage/s, about twice ball_lightning).
- 문제:
  - Melee vs bosses: +32 % (x3 +78 %), well above the rare band for an item that also blocks bullets.
- 제안: familiars.ts WinterOrb.update: this.contact(w, 5, dmgOf(w) * 0.45, 0.7, [{ kind: 'slow', duration: 2, power: 0.5 }]). The per-enemy contact cooldown goes 0.4 -> 0.7 s; damage, slow, freeze chance and bullet blocking are unchanged. Desc unchanged.
- 기대 결과: Measured with the patch: - Boss-size: 1.056 / 1.079 / 1.224; x3 1.23 / 1.24 / 1.46. - Small dummy unchanged: 1.06 / 1.07 / 1.05. - Crowd 1.12; late 1.047 / 1.028 / 1.011.

<details><summary>정상 판정 유물의 근거</summary>

- **연기 베일 (smoke_veil)**: stats: dodge +0.10 x power (linear, clamped 0.75). Player.hurt rolls w.rng.chance(dodge); a dodge gives 0.4 s invuln and a 'MISS'. onDash: spawns a SmokeScreen (gameplay entity, not cosmetic, which is correct) at the dash origin, radius 18 + 4(power-1), lasting 1.1 s. Every step it calls w.clearEnemyBullets inside its radius and proc('smoke_veil'); the particles use fx. In co-op the smoke belongs to the dashing keeper (spawnOwner/ctxP). 측정: Damage-neutral: 1.00 alone, in crowds, at x3 and late (the bot never dashes or gets hit). Corrected late 1.00. Reference: the dodge blessing gives 12%/copy.
- **쌍둥이 그림자 (twin_shadow)**: Familiars: min(2, power) shadows that trail the keeper. onAttack is gated to the keeper cadence (1/keeperFR). Each shadow fires one copy: - ranged: a shot of 0.35 x keeper damage (TWIN_SHADOW_DAMAGE) using keeper shotSpeed/projSize and range x0.9. - melee: a slash projectile of 0.35, pierce 6, range 48. Shots are generation 1 and go through Familiar.shoot/effectProc. No proc() call. 측정: 6 seeds: - x1: 1.35 / 1.273 / 1.188, crowd 1.35; boss-size 1.35 / 1.27 / 1.24. - x2: 1.638 / 1.55 / 1.404 (cap 2 shadows, so x3 = x2). Corrected late 1.223 / 1.167 / 1.101; audit 1.223 / 1.167 / 1.117.
- **구리 코일 (copper_coil)**: onHit on a primary hit: rollHit 10 % (x hitShare, copies 1-(0.9)^n) -> chainLightning from the target. 2 jumps, 0.7 x keeper damage, 0.85 decay per jump, range 85, excludes the hit target. Throttled by effectProc (0.2 s). 측정: Single target 1.00 (0.99-1.06 noise; the hit target is excluded). Crowd 1.163 lantern / 1.112 nail. Corrected late 1.033 / 0.978 / 0.979. The audit 'alone' row is byte-identical to rime_shard's: crit noise from one extra w.rng draw per hit.
- **천둥 북 (thunder_drum)**: onRoomEnter arms the drum (uncleared rooms only). When live, non-dormant real enemies first exist: skyBolt every one for 1.5 x keeper damage x stackMul(power) plus a 0.8 s stun. Bosses get a stun ≤0.25 s, gated 2 s. Once per room per floor/stage (key in w.vars); re-entry and later waves do not re-arm. Flash, shake and proc(). 측정: Damage-neutral in the harness (no room start); late 1.00-1.02. Analysis: - Floor 1 (keeper 10 damage, fodder 13-26 HP): one-shots fodder. - Floors 6-7: about 10-20 % of a regular's HP plus a room-wide 0.8 s stun. - Bosses: one bolt.
- **서리 조각 (rime_shard)**: modifyHit on an attack hit: rollHit 15 % (x hitShare, copies 1-(0.85)^n) -> addHitStatus slow 2.5 s, power 0.45 (bosses capped at 0.3). No damage. It feeds frostbite_ring and the 서리 III freeze-on-slowed tier. 측정: Single ≈ 1.00 (0.99-1.06, crit noise from the extra w.rng draw). Crowd 1.006 / 1.02. Corrected late 1.062 / 1.02 / 1.008, from synergy with slow-conditional items in the builds.
- **동상 반지 (frostbite_ring)**: modifyHit: if the target is slowed or frozen, amplify +0.2 x power (linear, pooled HitInfo.amp) and a quiet proc. Works on bosses: freeze becomes slow there, and slow stays slow. 측정: Alone 1.00 (no slow source). With rime_shard, as (rime+ring)/none, with rime alone ≈ 1.0: - 1.145 / 1.175 / 1.13 (void 1.11, bell 1.19, bow 1.16, gatling 1.165) - boss-size 1.145 / 1.187 / 1.134 So the ring is +13-19 % when a slow source is up. Corrected late 1.138 / 1.075 / 1.029 (audit 1.123 / 1.083 / 1.085).
- **빙정 나선 (crystal_spiral)**: stats: range x(1+0.2p), linear. onAttack every ≥0.8 s (w.vars.__spiralReady): spawnShards 2 side shards at ±0.45 rad, 0.2 x keeper damage each, plus slow 1.2 s at 0.35. Generation 1, keeper shotSpeed/range. The aimed shot is untouched. onAttack is not an auto-proc hook, so there is no proc flash. 측정: Small dummy 1.00 (blade 1.08); crowd 1.16 / 1.16; boss-size dummy 1.149 / 1.158 / 1.129. Corrected late 1.015 / 1.0 / 1.066 (audit 1.067 / 1.0 / 1.052). The test in artifact-rework.test.ts covers the cooldown.
- **빙하 렌즈 (glacier_lens)**: stats: projSize +1.2p, shotSpeed x Math.pow(0.88, p), damage +0.5p (flat, +5 %). modifyHit on an attack hit to a non-frozen target: rollHit 10 % -> freeze 1.2 s. Bosses get slow 0.45, capped to 0.3. Frozen enemies take +20 % from non-status hits (Enemy.takeHit), and freezing stops them. 측정: 8 seeds: - single: 1.084 / 1.096 / 1.086 (void 1.08, bell 1.395, bow 1.13, gatling 1.105) - crowd 1.08 / 1.10 - boss-size 1.06 / 1.10 / 1.07 - x3 1.31 (linear) Corrected late 1.062 / 1.094 / 1.104 (audit 1.105 / 1.122 / 1.130).
- **상고대 망토 (hoarfrost_mantle)**: onAcquire/onUpdate grantPerCopy: +1 soul heart (addSoul(2)) per copy. onHurt, with effectInterval 1.5 s: - freeze every enemy within R = 90+15(p-1) for 1.8 s (bosses: slow) - clearEnemyBullets within 1.2R - flash, ring and sfx (cosmetic) The hurt keeper's context is used in co-op. 측정: Damage-neutral (1.00). artifact-rework.test.ts verifies the 1.5 s gate and the all-enemies freeze.

</details>

분석가가 본 계열 밖의 문제:
- AUDIT HARNESS BUG (tests/item-audit.test.ts, artifacts mode): the late-build base cache key is `${wid}\|${i}`, but the base build b = b0.filter(x !== id).slice(0, 10) depends on the artifact being measured. When an artifact is in build i, its b keeps b0[10]; when it is not, b0[10] is dropped. Whichever artifact the shard processes first fixes the cached base for every later one. So for builds that contain the artifact (and for whole shards when the first artifact was in the build) the ratio measures a different item. Fix: key the cache by `${wid}\|${i}\|${b.join(',')}`. Corrected medians differ from all.json: - hollow_mask: 0.967 / 0.929 / 0.991 (all.json 1.006 / 0.929 / 1.058) - glacier_lens: 1.062 / 1.094 / 1.104 (all.json 1.105 / 1.122 / 1.130) - rear_eye blade: 1.269 (all.json 1.205) - tempest lantern: 1.198 (all.json 1.239) - crystal_spiral: 1.015 / 1.0 / 1.066 (all.json 1.067 / 1.0 / 1.052) - black_candle nail: 1.15 (all.json 1.107) - winter_orb: 1.047 / 1.028 / 1.011 (all.json 1.055 / 1.046 / 1.042) Re-run the audit before final decisions on other families.
- Audit 'alone'/'crowd' noise is dominated by crits (5 % crit x1.8, about 21 lantern shots in 8 s). Any item that consumes one extra w.rng draw per hit shifts the stream: rime_shard and copper_coil have byte-identical alone rows (lantern 1.12, bell 0.96) while doing nothing to a single dummy. stormcaller_rod read exactly 1.000 in crowd because no draw fell in [0.05, 0.11). Average ≥6 seeds for alone/crowd/x3.
- The audit dummy has radius 7. Boss-sized targets (I mutated Enemies.must(DUMMY_ID).radius = 20 in a scratch run) change spread and orbital items a lot: - paper_fan lantern 0.82 -> 1.26 - winter_orb blade 1.05 -> 1.32 - crystal_spiral 1.00 -> 1.15 - rear_eye blade 1.39 -> 1.42 A big-dummy column in item-audit would catch boss outliers that the late band misses.
- MeleeSwing.contains (src/game/melee.ts:93) returns true for any target within pr + 6 of the swing origin whatever the angle. Any item that spawns an off-angle swing (rear_eye) also hits what the keeper hugs in front, which is every boss (pr 16-30).
- Familiars of one kind share a single proc key 'familiar:<key>' (0.2 s, lib.syncFamiliars) and spawn with identical timers. Duplicates that fire on a synchronized timer are throttled to nothing (ball_lightning). Check other timer-based familiars (gear_turret etc.) for the same pattern.
- onAttack is not in EVENT_HOOKS (game/items.ts), so lib helpers called from onAttack (spawnShards in crystal_spiral, Familiar.shoot in twin_shadow, rear_eye's volley) never auto-proc. These artifacts get no HUD flash or icon pop. Either add explicit proc(w, id, true) calls or treat onAttack as an event hook (PROC_FLASH_CD 0.6 s rate-limits it).
- Item stat multipliers apply to both keeper and weapon stats, so a shot-only price (paper_fan's damage x) also cuts releases, familiars and artifact procs. There is no weapon-only channel for item mods. A small backward-compatible StatMods channel (e.g. weaponOnly mul) would make shot-trade items fair.
- Copies stacked with Math.pow outside the rule: blessings.ts:69 (dash blessing dashCooldown 0.75^power, same as night_slippers), glacier_lens shotSpeed 0.88^power, static_cape dashCooldown 0.92^power.
- tests/presence.test.ts 'common stat artifacts are noticeable (>= +15% of a base stat)' pins black_candle, long_wick, quick_feather and cracked_hourglass at ≥ +15 %. That conflicts with the common late band (1.04-1.12); those commons audit at 1.15-1.23 late. The threshold must follow the new band if they are lowered.
- static_cape carries the shadow tag, so night_slippers + static_cape alone light 그림자 II (dash cd -15 %). With the current numbers that is 88-91 % dash-spam invulnerability from two commons.
- Fear and charm are dropped entirely on bosses (lib.bossSafe), so any 'bonus vs feared/charmed' item is a boss no-op (hollow_mask; check sweet_sachet / charm items).
- moon_satellite (orbital contact 0.7 x damage per 0.3 s) likely has the same melee-vs-boss constant-contact issue as winter_orb (audit late blade 1.16 vs lantern 1.02). A per-enemy contact cd around 0.6-0.7 s would equalize it.
- Several details carry duplicated or irrelevant boilerplate ('추가 효과 최소 간격 0.2초, 같은 적 상태 재부여 0.5초. 중복·무기 교체 시 간격 공유.'): thunder_drum and tempest_heart repeat it twice; hoarfrost's real interval is 1.5 s; the drum is once per room. A pass that writes item-specific numbers into detail would help the Korean text match the code.
- shade_dagger in co-op: e.mem.__dagCd is shared between keepers (one keeper's cut blocks the other's), and e.mem grows a '__dag<n>' key per dash per enemy cut.

메모: I covered all 20 artifacts in shadow.ts, storm.ts and frost.ts (absolute paths: /home/user/REPOSI/src/content/items/shadow.ts, /home/user/REPOSI/src/content/items/storm.ts, /home/user/REPOSI/src/content/items/frost.ts; familiar logic is in /home/user/REPOSI/src/content/items/familiars.ts). **What I changed in the repo:** nothing under src/. I ran three temporary scratch tests (tests/_scratch_ssf_measure, tests/_scratch_ssf_variants, tests/_scratch_ssf_late), always with --maxWorkers=1, and deleted them; the git tree is clean. Proposed variants were checked by patching artifact defs or familiar prototypes inside the scratch process only. **How I measured:** - Every ratio averages 6-8 seeds, 6 s, max of near and far. - "Boss-size" means the dummy radius was set to 20 in-process. - "Dash" uses measureDps's dash option, so the item is compared with the same dashing bot without it. - My late medians rebuild the base per build. The audit's onLate numbers carry a cache bug (see crossCutting), so prefer the corrected values I quote. **Proposed changes, by priority:** 1. **ball_lightning:** extra spirits never zap (bug). Make the spirits take turns and stagger them; damage 0.85 -> 0.75. 2. **rear_eye:** on melee it is a free hit on the front target. Only fire when an enemy is really behind, and add proc(). 3. **paper_fan:** charges melee/beam weapons for shots they never fire, and is +21-39 % vs boss-size targets. Becomes a no-op on melee/beam; damage x0.65 (-0.07 per extra copy); fireRate penalty removed. 4. **tempest_heart:** per-hit chain is not weighted by hit size (nail crowd 2.70). Gate it with rollHit(w, hit, 1, 1). 5. **night_slippers:** 58-91 % dash-spam invulnerability. Dash cooldown 1/(1+0.25p), extension +0.1 s. 6. **static_cape:** no dash-spam guard. Add effectInterval 1 s and damage 0.6; linear dash cooldown. 7. **shade_dagger:** per-enemy cooldown 2 -> 3 s. 8. **winter_orb:** contact cooldown 0.4 -> 0.7 s (melee vs boss 1.32 -> 1.22). 9. **black_candle:** +1.5 -> +1.2 damage (needs the presence-test threshold change). hollow_mask (optional boss "dread" fix) and stormcaller_rod (optional crit-target fallback) are weak. I did not recommend buffs for them in this downward pass. The others are ok: smoke_veil, twin_shadow, copper_coil, thunder_drum, rime_shard, frostbite_ring, crystal_spiral, glacier_lens, hoarfrost_mantle. Their small text or presence nits are in issues. **Tests that would need updating:** - tests/power-budget.test.ts: paper_fan factor 0.75 -> 0.65. - tests/presence.test.ts: black_candle threshold. - No existing test covers the other proposals, apart from the release-audit synergy list, which should still hold. **Rule checks:** no Math.random and no ** in these files; all fx use is cosmetic. Remaining violations are covered above (Math.pow on copies, the tempest per-hit proc, the missing onAttack procs).

## 분석: star+trinkets (검증 전)

정상 판정 12개: 별바늘(constellation_needle), 성도(star_chart), 작은 달(moon_satellite), 혜성 꼬리(comet_tail), 연금술사의 저울(alchemist_scale), 영혼 밀랍(soul_wax), 돌거북 부적(stone_amulet), 등잔 기름(lamp_oil), 옥구슬(jade_marble), 탐욕의 지갑(greedy_purse), 거울 파편(mirror_shard), 달콤한 향주머니(sweet_sachet)

### 떨어진 별 조각 (fallen_star) — 일반, 수정 필요, 확신 high
- 파일: src/content/items/star.ts
- 실제 동작: stats: luck +1·power, critChance +0.06·power (base crit 5% → 11%, critMult 1.8). onHit: on every crit that isPrimary (gen-0 projectile / melee / beam / weapon explosion) adds a FLAT 3·power ember (×0.5 for laser, ×0.5 vs bosses, then ×(1+0.02·luck) inside addEmber). Copies linear. Look shot+star shape+trail, proc() on each ember charge. Helps every weapon type (crit applies to melee and beam).
- 측정: late 1.049 / 1.064 / 1.071 (lantern/nail/blade); alone 1.06-1.08 on 6 weapons, lantern 1.000 is seed noise (no crit rolled at 11% in 8 s); x3 1.20 (= linear 1+3·0.065). Ember is not measured (bot never releases).
- 문제:
  - The ember charge is a flat +3 per crit hit, whatever the hit size. CLAUDE.md says ember's flat charge must follow the hit size. Pellet, nail and gatling weapons crit per pellet, so on bell_blunderbuss / nail_carbine / crystal_gatling the item fills the gauge about 2-4x faster per second than on lantern_bolt. That inflates the release share.
  - DPS sits in the common band, so no number change is needed for damage.
- 제안: star.ts onHit: scale the charge by the hit's share, the same way attackEmber does. Import hitShare from './lib', then: `const share = Math.min(1, hitShare(w, hit)); w.player.addEmber(3 * power * share * (hit.kind === 'laser' ? 0.5 : 1) * (t instanceof Enemy && t.isBoss ? 0.5 : 1));`. A crit of a normal shot or swing has share >= 1 and stays at 3; small pellets and ticks charge 0.75-3. Update the detail to: '기본 충전 +3(작은 타격은 크기에 비례, 최소 1/4). 광선·보스 대상은 각각 절반. 추가 파편 제외. 행운 보정 적용.'
- 기대 결과: DPS unchanged (late ~1.05-1.07). Ember from this item drops ~40-75% on multi-pellet and fast weapons and is unchanged on single-shot, melee and bow weapons.

### 복나방 (fortune_moth) — 희귀, 수정 필요, 확신 high
- 파일: src/content/items/star.ts
- 실제 동작: stats: luck +2·power. onRoomClear: in 'normal' rooms only, roll(0.25, power, luckK 0) (1-0.75^n) drops w.dropRandom(...,'room') near the center, calls proc() and plays particles. Co-op: each keeper that holds it rolls separately.
- 측정: late 1.000 / 1.016 / 1.036 (luck nudges proc chances and ember +4%); economy not measured.
- 문제:
  - Desc says '방 클리어 시', but the code only fires in normal rooms (boss / challenge / mission clears are excluded). The numbers match. This is a precision-only text fix.
- 제안: Desc-only change, no code change: make the text say 일반 방.
- 새 설명: 행운 +2. 일반 방 클리어 시 25% 확률로 보상이 하나 더
- 기대 결과: unchanged

### 광휘의 창 (radiant_lance) — 전설, 너무 강함, 확신 high
- 파일: src/content/items/star.ts
- 실제 동작: unique. stats: range ×1.3. onShoot: the first weapon projectile (gen 0) of a frame within 1.1 rad of aim becomes a lance: pierce +99, spectral, speed ×1.3 from weaponStats.shotSpeed, radius >= 4, knockback ×1.5, amplifyShot 0.25·(power-1). Later projectiles in the same frame are killed and merged into it at 0.9 of their damage (weaponDamage payloads merged too). onAttack (melee weapons only): spawns an extra gen-1 lance projectile for 0.8 × keeper stats.damage per attack. That lance is gated only by effectProc's 0.2 s gap, not by the keeper's cadence. Beam weapons get only the range.
- 측정: late 1.020 / 1.011 / 1.380 (blade far above the legendary band 1.15-1.26); alone blade 1.525, bell 1.107 (pellets fused), dawn_lantern 0.923 (3 homing beams that all land anyway lose 10% on 2 of 3), others 1.00; crowd 3.12 (infinite pierce through the line of 3 dummies, cap 2.3). My scratch replication matched exactly (blade 1.525, crowd 3.12, blade late 1.380). Crowd: dawn 1.93, bell 2.73, nail 2.98.
- 문제:
  - The melee extra lance (0.8 × damage, piercing, every swing) makes melee builds +38% late: an outlier.
  - The melee lance is a per-attack spawner without the keeper-cadence gate (rule: per-attack spawners run at most at the keeper's cadence). Fast melee weapons scale it beyond 2.6/s.
  - Infinite pierce at full damage puts crowd at 3.12, well over the legendary soft cap 2.3, even for a line-AoE identity item.
  - dawn_lantern single-target 0.923 is a mild penalty from the 0.9 merge tax. The pierce benefit still applies there (crowd 1.55 even after the fix below), so I left the merge factor alone. Raising it would buff spread weapons.
  - x3 1.50 is unreachable (unique).
- 제안: star.ts. (1) onAttack: lance damage `dmg(w) * 0.8` → `dmg(w) * 0.45`, and gate it at the keeper's cadence before effectProc: `if (!cooldown(w, 'radiant_lance', 1 / Math.max(0.5, w.player.stats.fireRate)) \|\| !effectProc(w, () => true)) return;` (import cooldown from './lib'). (2) In makeLance, give the existing 'lance_glow' behavior an onHit falloff so each enemy pierced weakens the lance: `onHit(pr, _w2, target) { if (!(target instanceof Enemy)) return; const base = Number(pr.mem.lanceBase ?? (pr.mem.lanceBase = pr.damage)); const next = Math.max(base * 0.35, pr.damage * 0.7); if (pr.mem.weaponDamage !== undefined) pr.mem.weaponDamage = Number(pr.mem.weaponDamage) * (next / Math.max(1e-6, pr.damage)); pr.damage = next; }`. This only touches the projectile's own state and is deterministic. (3) New detail: '근접 공격에는 공격력 45% 창을 추가 발사한다(등불지기 공격 속도 이하). 창은 적을 꿰뚫을 때마다 피해 30% 감소(최저 35%). 광선과 추가 파편에는 적용되지 않는다. 추가 효과 최소 간격 0.2초, 같은 적 상태 재부여 0.5초. 중복·무기 교체 시 간격 공유.' The desc line stays.
- 기대 결과: Measured with in-process patches: blade alone 1.525→1.309, blade late 1.380→1.222, lantern crowd 3.12→2.26, crowd dawn 1.93→1.55, bell 2.73→2.02, nail 2.98→2.14; lantern/nail late unchanged (~1.00-1.02); dawn alone 0.923 and bell alone 1.107 unchanged.

### 품 안의 태양 (lantern_sun) — 전설, 수정 필요, 확신 high
- 파일: src/content/items/star.ts
- 실제 동작: unique; min(2, power) LanternSun familiars (familiars.ts) orbit at radius 36 at 1.45 rad/s and melt enemy bullets within 10 px. Contact itemHit: 1.1 × keeper damage per enemy per 0.35 s, plus burn 3 s at 0.5×dmg/s. Aura every 0.5 s: zoneDamage 0.25 × dmg plus burn 2 s at 0.4×dmg/s to every enemy within 26 px. Burn does not stack; it takes the max power. Everything reads the keeper's stats.damage (correct for a familiar).
- 측정: late 1.202 / 1.197 / 1.187 (in band); alone 1.29-1.42; crowd 2.38 (just over the legendary cap 2.3); x3 1.77 unreachable (unique). Scratch variants: aura 0.20 → crowd 2.335; aura 0.15 → crowd 2.288, late 1.192 / 1.176, alone 1.41; contact 0.95 → crowd 2.30, late 1.183; contact cd 0.40 leaves crowd unchanged.
- 문제:
  - Crowd 2.38 is slightly above the legendary soft cap 2.3. It is an AoE-identity item, so it should sit at the cap, not over it.
  - No proc(): the HUD row never flashes when the sun blocks or burns (familiar cross-cutting issue).
- 제안: familiars.ts LanternSun.update aura tick: `zoneDamage(w, e, dmgOf(w) * 0.25, 'burn', ...)` → `dmgOf(w) * 0.15`. Contact, burns and bullet melting stay as they are. The desc has no numbers, so no text change.
- 기대 결과: crowd 2.38→2.29, late lantern 1.20→1.19, blade 1.19→1.18, alone lantern 1.42→1.41 (measured).

### 금니 (gilded_tooth) — 일반, 너무 강함, 확신 medium
- 파일: src/content/items/trinkets.ts
- 실제 동작: onAcquire/onUpdate: grantPerCopy gives +5 coins per copy. stats: FLAT damage +min(2.5, floor(coins/10)·0.25) × stackMul(power). Flat adds are applied before multipliers and outside the pooled knee, so +1 is about +10% on any build. watch() recomputes stats when the 10-coin tier changes (capped at 10). Coins cap at 999, so the max needs 100 coins. Never calls proc().
- 측정: Audit reads 1.000 (harness keeper has <10 coins). Scratch (coins forced at acquire, 8 late builds): 30 coins late 1.070, 60 coins 1.140, 100 coins 1.233 (lantern = nail). With copies: stackMul 1.6 / 2.0 → up to +40% / +50% at 100 coins.
- 문제:
  - At 100 coins a single common adds +23% damage on a late build, far above the common band (1.04-1.12). Late floors often leave coins unspent, so this tail is reachable, and the flat add sits outside the pooled knee.
  - No proc() call: the HUD never flashes when the bonus tier rises (minor presence gap).
- 제안: trinkets.ts stats: `Math.min(2.5, Math.floor(coins / 10) * 0.25)` → `Math.min(1.25, Math.floor(coins / 10) * 0.25)`. onUpdate watch: `Math.min(10, ...)` → `Math.min(5, ...)`. Optional presence: in onUpdate, when the tier rises (compare to `w.vars.__toothTier`), call `proc(w, 'gilded_tooth', true)` and store the new tier. The per-10-coin rate stays the same, so the early feel is unchanged.
- 새 설명: 동전 +5. 동전 10개당 공격력 +0.25 (최대 +1.25)
- 기대 결과: 30 coins: 1.07 (unchanged); 50+ coins: ~1.116 max (was up to 1.233). 2 copies max ~+19%, 3 copies ~+23%, sublinear.

### 종이 부적 (paper_ward) — 일반, 너무 강함, 확신 medium
- 파일: src/content/items/trinkets.ts
- 실제 동작: onRoomEnter of any uncleared room (normal, boss, challenge ...): if shields < power, set shields = power. Player.hurt spends a shield to cancel the whole hit and grants 0.6 s invuln. Copies give power shields per room (linear). Draws the paper charms orbiting the keeper and calls proc on refill. Co-op: per keeper.
- 측정: DPS-neutral. By function: it cancels up to one hit (1-2 half-hearts on floors 1-6, 2-4 from floor 7) in every combat room, about 8-12 hits per floor.
- 문제:
  - Out-survives every comparable item. ember_heart (common) is +1 container and +½ per floor. soul_wax (common) is +1 soul and +½ per floor. stone_amulet (common) is +1 container and i-frames. Even hoarfrost_mantle (epic) is +1 soul and a freeze/clear on hurt that doesn't stop the hit. A per-room full-hit negation is worth roughly 3-5x those over a floor, and the blessing bless_aegis gives the same shield only in boss rooms. Defense outlier for a common.
- 제안: Rarity 'common' → 'rare' in trinkets.ts. Effect, pools and desc unchanged; this keeps the '딱 한 번' identity and puts it next to the rare bullet-blocker orbitals (moon_satellite, mirror_shard). Alternative if it must stay common: only refill on every second combat room (`w.vars.__wardRooms` counter), desc '전투가 두 번 시작될 때마다 피해 1회를 막는 보호막을 얻는다'.
- 기대 결과: Same function; it appears less than half as often (loot weight 60→28) and at rare shop prices.

### 산탄 화약통 (cluster_powder) — 에픽, 약함, 확신 medium
- 파일: src/content/items/trinkets.ts
- 실제 동작: grantPerCopy +2 bombs per copy. onUpdate watches every Bomb with owner 'player' in a module WeakMap keyed by World. When one detonates (fuse <= 0), it calls spawnShards with 8+2·(power-1) spectral shrapnel: (1.2·dmg+6) each, burn 2 s at 0.3×dmg/s, speed 240, range 120. Throttled 0.2 s by effectProc. Only placed bombs (Player.placeBomb: 60 + 2·dmg, radius 38) count.
- 측정: DPS 1.00 (no bombs in the harness). Estimate: each bomb adds ~50-150 shrapnel damage to adjacent enemies; bombs are scarce (~2-4 per floor), so it is well under 1% of run damage. That is roughly tick_bomb (common: +3 bombs + stop) level, not epic.
- 문제:
  - Clearly below its rarity: an epic slot that is effectively '+2 bombs'. Per the direction, a rarity correction is preferable to a number buff.
  - Co-op bug: the desc says '내 폭탄', but it watches every player-team bomb, and the WeakMap is keyed by World. A keeper holding it fires shrapnel (with its own damage) from teammates' bombs, and two holders share one watch list.
- 제안: (1) Rarity 'epic' → 'rare', numbers unchanged. (2) Co-op ownership in trinkets.ts: key `bombWatch` by `w.player` instead of `w` (WeakMap<object, Map<Bomb, unknown>>), and register only `e instanceof Bomb && e.owner === 'player' && !e.dead && (!w.coop \|\| e.ctxP === w.player)`. World.spawn sets ctxP from spawnOwner during the placer's update. Solo behaviour is identical.
- 기대 결과: Solo power unchanged; it shows up as rare. Co-op: only the holder's own bombs scatter shrapnel.

<details><summary>정상 판정 유물의 근거</summary>

- **별바늘 (constellation_needle)**: modifyHit: on isAttack hits without a mark, rollHit(0.15, power) weighted by hitShare adds status 'mark' for 6 s through addHitStatus (primary hits only, 0.2 s proc gap, 0.5 s per-target status gap). World.applyHit makes the next non-status hit on a marked enemy a guaranteed crit (×critMult 1.8) and consumes the mark. Copies stack via 1-(1-p)^n. Proc comes from addHitStatus→procHere. 측정: late 1.090 / 1.075 / 1.031; alone lantern 1.12, blade 1.21 (big swings: share up to 2 → 30% chance, and a bigger next hit), others 1.01-1.11; crowd 1.12; x3 1.24 (below linear 1.36).
- **성도 (star_chart)**: stats: homing +2.6·power and range ×1.1 (applied once, not per copy). Shots only. Melee and beam get just the range, with no penalty. It is in VISIBLE_STATS, so it needs no signature. 측정: late 1.022 / 1.025 / 1.018; alone 1.000 except bell_blunderbuss 1.258 (homing pulls pellets that would miss); x3 1.00. The immobile dummy hides the main value, which is accuracy against moving enemies.
- **작은 달 (moon_satellite)**: min(3, power) MoonSatellite orbitals (familiars.ts) circle at radius 21 at 2.8 rad/s. They block enemy bullets within 5.5 px and deal contact itemHit of 0.7 × keeper stats.damage per enemy every 0.3 s (crits allowed, no on-hit procs). Familiar shots and hits run in a 'familiar:moon_satellite' proc context. Co-op: each keeper has its own (famKey slot). 측정: late 1.022 / 1.057 / 1.157 (only reaches enemies in melee range); alone blade 1.127, ranged 1.00; crowd 1.31; x3 1.00 on lantern (moons never reach a dummy at 40-70 px).
- **혜성 꼬리 (comet_tail)**: stats: critMult +0.35·power (1.8 → 2.15, additive, not pooled). onHit: on a primary crit, spawnShards spawns 2+power homing spectral star shards, each min(stats.damage, hit.damage/critMult) × 0.3. Shards are sized from the crit's own hit and throttled at 0.2 s by effectProc. Shards are generation 1, so they never chain. With base 5% crit the item is ~+6%; it scales with crit chance (build-around). 측정: late 1.129 / 1.060 / 1.069 (median 1.07, below the epic band 1.12-1.22 on nail and blade); alone 1.05-1.14; lantern alone and x3 read 1.000 because the AUDIT-lantern_bolt seed rolls no crit in 8 s (noise).
- **연금술사의 저울 (alchemist_scale)**: onPickup coin/nickel/dime: adds the value × max(1, round(greed)) to w.vars.__scaleGold (per keeper). Each time it reaches max(10, 20-3·(power-1)), it pops a bomb, then a key, alternating. Shows '보급 x/n' and calls proc on every coin pickup. Co-op: per keeper (vars and pickup context). 측정: DPS-neutral (1.00). Economy: about 1 bomb or key per 20 coins collected.
- **영혼 밀랍 (soul_wax)**: grantPerCopy: +1 soul heart (2 half) per copy. onFloorStart: +power half soul hearts and proc. Matches the desc. 측정: DPS-neutral. About the same value as ember_heart (common).
- **돌거북 부적 (stone_amulet)**: stats: maxHearts +power, invuln ×(1+0.3·power) (1.0 s → 1.3 s, linear per copy). onHurt (only when real damage lands; a shield or dodge returns before onHurt): clearEnemyBullets in radius 46+10·(power-1), particles and proc. Desc numbers match. 측정: DPS-neutral. Slightly more than ember_heart (container plus i-frames plus a small clear) and clearly less than hoarfrost_mantle (epic: soul, freeze R90, clear R108).
- **등잔 기름 (lamp_oil)**: onRoomClear (every cleared room, dispatched to every keeper's items in co-op): addEmber(20·power) (×(1+0.02·luck)), particles and proc. EMBER_MAX 100, so desc '+20%' matches. Linear per copy. 측정: late 1.000 / 1.036 / 1.050 (harness noise; the bot never releases). Estimate: shooting gives ~50-60 ember per room, so +20 means ~35% more releases. With releases capped at ~20% of run damage, that is roughly +5-7% run damage, inside the common band.
- **옥구슬 (jade_marble)**: stats: bounce +2·power, range ×(1+0.15·power), both linear. Shots only. Melee gets a tiny reach bonus from range; beams get nothing extra; no penalty anywhere. It is in VISIBLE_STATS. 측정: DPS 1.00 everywhere (no walls matter against a stationary dummy).
- **탐욕의 지갑 (greedy_purse)**: onKill of non-minions: roll(0.12, power, luckK 0.005) drops a coin and procs. onHurt: drops min(2, coins) coins around the keeper with a 0.8 s grace, so they can be picked back up (no scaling, no proc). Matches the desc. 측정: DPS-neutral. About 60 kills per floor → ~7 coins per floor; the drawback is mild because the coins can be recollected.
- **거울 파편 (mirror_shard)**: min(2, power) MirrorShard orbitals at radius 16, 4.2 rad/s. Each blocks enemy bullets within 5 px and reflects every blocked bullet as a gen-1 homing (3) player shot for 0.9 × keeper damage at the nearest enemy (Familiar.shoot, throttled 0.2 s per 'familiar:mirror_shard' effect, shared by both shards). A bullet is still blocked when a reflection is throttled. 측정: DPS 1.00 in the harness (no enemy bullets). Estimate: about a third of bullets aimed at the keeper hit a shard, so bullet-heavy fights gain ~+5-15%. Capped at 5 reflections per second.
- **달콤한 향주머니 (sweet_sachet)**: modifyHit: against a non-boss enemy that is not charmed, has hp >= 50% max and will survive the hit, when w.vars.__sachetReady <= time and procReady('a:sweet_sachet'): addHitStatus charm 4 s (primary hits only) and sets the next ready time to max(3, 6-(power-1)) s. Bosses are immune via bossSafe. The detail matches the code. 측정: DPS-neutral. One crowd-control target every 6 s.

</details>

분석가가 본 계열 밖의 문제:
- Familiars never report procs: lib.Familiar.update runs inside withProcContext('familiar:<id>'), but ItemSystem.autoProc only works during an item event hook (this.cur / curEvent). So moon_satellite, mirror_shard and lantern_sun (and gear_turret, ball_lightning, winter_orb, twin_shadow in familiars.ts) never flash their HUD row when they block, hit or reflect. The presence test does not catch it. A small fix in lib.Familiar: in contact() (when hit.length > 0), blockBullets() (n > 0) and shoot() (when spawned), call `proc(w, this.procEffect?.replace('familiar:', '') ?? '', true)`. The co-op context is already the owner through ctxFor.
- Flat `addStat('damage', x)` bypasses POOLED_STATS / softBonus. Flat adds go to base before multipliers, so +1 is about +10% on any late build, even past the +100% knee. Users: gilded_tooth, wind_up_key (+0.25 per key, cap +3 = +30%: the same tail problem as gilded_tooth, and already 1.12-1.16 late), leech_tooth, black_candle, long_wick, blood_moon. Either the flat pool should be capped or the conditional caps should be lowered (I proposed 1.25 for gilded_tooth).
- iron_quill (common, blood.ts) has crowd 2.32 against a common cap of 1.5: the same line-pierce structure as radiant_lance, and it even gains +20% per pierce. Another analyst should look at a falloff or cap there.
- Star resonance IV (resonance.ts: crits scatter 2 shards at 35%) duplicates comet_tail's identity (crits scatter 3 shards at 30%). Numbers are fine because shards are sized from the crit and throttled, but the two read as the same effect.
- Audit noise: 'alone lantern_bolt' and 'x3' for crit-dependent items (fallen_star, comet_tail) read 1.000 because the AUDIT-lantern_bolt seed rolls no crit at <=11% chance in 8 s. x3 rows for unique legendaries (radiant_lance 1.50, lantern_sun 1.77) can't happen in play: unique artifacts are excluded from loot once obtained.
- The DPS harness has no enemy bullets, no room clears and no releases, so mirror_shard / moon_satellite blocking, lamp_oil and fallen_star ember, and fortune_moth / greedy_purse economy are judged by reasoning, not measured.
- Bomb entities carry no owner keeper; only ctxP, and only in co-op. Any future 'my bombs' item needs the same `!w.coop \|\| b.ctxP === w.player` filter as my cluster_powder proposal (blessing onBomb hooks dispatch per keeper, so they are fine).

메모: I covered all 19 artifacts: 8 in star.ts and 11 in trinkets.ts. Measurements used the audit's exact dps() settings (8 s, best of 2 distances, same seeds, same 8 late builds from AUDIT-ART-LATE). Proposals were simulated by patching hooks inside a scratch test (tests/_scratch_startrink_measure.test.ts, run with --maxWorkers=1 in about 5-15 s per run). I deleted that file afterwards; no src/ or tests/ files were changed and the working tree is clean. My unpatched replication matched all.json for radiant_lance (blade 1.525, crowd 3.12, blade late 1.380) and lantern_sun (alone 1.4225, crowd 2.3825, late 1.20 / 1.187). Changes ranked by impact: 1. **radiant_lance** (too strong on melee and in crowds): melee lance 0.8 → 0.45 × damage with a keeper-cadence gate, and a ×0.7 falloff per enemy pierced (floor 35%). Measured: blade late 1.38 → 1.22, crowd 3.12 → 2.26, single-target ranged unchanged. 2. **lantern_sun**: aura tick 0.25 → 0.15 (in familiars.ts). Measured: crowd 2.38 → 2.29, late ~1.19. 3. **gilded_tooth**: max bonus +2.5 → +1.25. Measured at 100 coins: +23% late; capped value about +11.6%. 4. **paper_ward** (common → rare): a per-room full-hit shield out-survives every defensive common and even hoarfrost_mantle (epic). 5. **cluster_powder** (epic → rare): effectively '+2 bombs'. Also fixes a co-op bug: it currently fires on teammates' bombs and shares one watch list per World. 6. **fallen_star**: the flat +3 ember per crit should scale with hit size (CLAUDE.md rule), since pellet and nail weapons charge 2-4x faster today. 7. **fortune_moth**: desc-only wording fix ('일반 방'). Everything else is ok. comet_tail sits at the low end of the epic band, but it is a crit build-around, so no buff per the user's direction. All code uses w.rng for gameplay, with no Math.random and no ** in sim paths. The lanceReg and bombWatch WeakMaps are derived or per-room state that iterates deterministically.
