/** Public packaged Skill inventory. */
export const packagedSkills = [
  ['aterm-skills-aterm-basics-skill', '_aterm_skills:Aterm_Basics_Skill_'],
  ['aterm-skills-corpus-authoring-skill', '_aterm_skills:Corpus_Authoring_Skill_'],
  ['aterm-skills-corpus-maintenance-skill', '_aterm_skills:Corpus_Maintenance_Skill_'],
  ['aterm-skills-corpus-reading-skill', '_aterm_skills:Corpus_Reading_Skill_'],
  ['aterm-skills-explorer-presentation-skill', '_aterm_skills:Explorer_Presentation_Skill_'],
  ['aterm-skills-model-review-skill', '_aterm_skills:Model_Review_Skill_'],
  ['aterm-skills-modeling-skill', '_aterm_skills:Modeling_Skill_'],
  ['aterm-skills-naming-skill', '_aterm_skills:Naming_Skill_'],
  ['aterm-skills-runtime-management-skill', '_aterm_skills:Runtime_Management_Skill_'],
  [
    'aterm-skills-specification-implementation-skill',
    '_aterm_skills:Specification_Implementation_Skill_',
  ],
  ['aterm-skills-viewpoint-authoring-skill', '_aterm_skills:Viewpoint_Authoring_Skill_'],
] as const;
export const packagedSkillNames = packagedSkills.map(([name]) => name!);
export const installedNames = (...extra: string[]) => [...packagedSkillNames, ...extra].sort();
export const installedPaths = (...extra: string[]) =>
  installedNames(...extra)
    .map((n) => `${n}/SKILL.md`)
    .sort();
