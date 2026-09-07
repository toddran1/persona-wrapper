/** Server-owned values; neither the client nor AdMob callback supplies these. */
export const adRewardPolicy = {
  maxRewardedAdsPerDay: 3,
  mediaCreditsPerReward: 1,
  rewardType: "media_credit"
} as const;
