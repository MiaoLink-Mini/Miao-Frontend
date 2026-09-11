// Presentation only: these names must never be used to infer runtime capabilities.
function agentIcon(agent) {
  const name=String(agent && agent.name || '').trim().toLowerCase();
  const brands={codex:'codex','openai codex':'codex',claude:'claude','claude code':'claude',pi:'pi','pi coding agent':'pi'};
  const brand=Object.prototype.hasOwnProperty.call(brands,name)?brands[name]:'generic';
  return `/assets/agents/${brand}.svg`;
}
module.exports={agentIcon};
