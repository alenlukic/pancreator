/**
 * Operator brief registry and document shapes shared by the registry loader,
 * the brief parser, the HTML renderer, and the scaffold.
 */

export interface BriefDefinition {
  label: string
  description: string
}

export interface SectionSemantic extends BriefDefinition {
  emoji: string
}

export interface CardType extends BriefDefinition {
  layout: 'standard' | 'split-header'
  required_fields?: string[]
}

export interface BriefRegistry {
  schema_version: 1
  brief_types: Record<string, BriefDefinition>
  section_semantics: Record<string, SectionSemantic>
  card_types: Record<string, CardType>
  field_semantics: Record<string, BriefDefinition>
}

export interface ProjectBriefRegistry extends BriefRegistry {
  status: 'ready'
  project: { id: string; title: string }
  extends: 'pancreator'
}

export interface BriefStatus {
  label: string
  tone?: 'neutral' | 'positive' | 'warning' | 'negative' | 'info'
}

export interface BriefField {
  label: string
  value: string | number | boolean | string[]
  semantic?: string
  placement?: 'meta' | 'body' | 'footer'
  emphasis?: 'normal' | 'muted' | 'strong'
  href?: string
}

export interface BriefAction {
  label: string
  href?: string
  command?: string
  style?: 'primary' | 'secondary' | 'danger'
}

export interface BriefItem {
  title: string
  body?: string
  body_html?: string
}

export interface BriefCard {
  type: string
  title: string
  lede?: string
  status?: BriefStatus
  urgency?: BriefStatus
  fields?: BriefField[]
  body?: string
  body_html?: string
  items?: BriefItem[]
  actions?: BriefAction[]
}

export interface BriefSection {
  semantic: string
  title: string
  description?: string
  layout?: 'stack' | 'grid'
  cards: BriefCard[]
}

export interface OperatorBrief {
  schema_version: 1
  brief_type: string
  title: string
  subtitle?: string
  eyebrow?: string
  generated_at?: string
  source?: string
  sections: BriefSection[]
}

export interface BriefSystemValidationResult {
  status: 'passed' | 'failed'
  errors: string[]
  common_registry_path: string
  project_registry_path: string
  project_css_path: string
}

export interface BriefBuildResult {
  status: 'built' | 'unchanged'
  project_registry_path: string
  project_css_path: string
  created: string[]
}

export interface BriefRenderResult {
  status: 'rendered'
  input_path: string
  output_path: string
  brief_type: string
  sections: number
  cards: number
}
