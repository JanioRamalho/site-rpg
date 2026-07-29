export function createCampaignService(firebase) {
  async function createCampaign(campaign) {
    await firebase.saveCampaign(campaign);
    return campaign;
  }

  async function joinCampaign({ campaignId, campaignPassword, profile, playerName }) {
    return firebase.joinCampaign(campaignId, campaignPassword, profile, playerName);
  }

  async function deleteCampaign(campaignId) {
    return firebase.deleteCampaign(campaignId);
  }

  function watchUserCampaigns(userId, onChange, onError) {
    return firebase.watchCampaigns(userId, onChange, onError);
  }

  return {
    createCampaign,
    deleteCampaign,
    joinCampaign,
    watchUserCampaigns
  };
}
