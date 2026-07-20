## Objective

Package the ratified design outputs into a stable design package the operator can
reference from a separately started corresponding `dev` run.

## Steps

1. Read successful intake, design, review, and test outputs.
2. Assemble `design_package` with a concise summary, the stable design-spec path,
   mocks index, Figma artifacts list (or empty with degradation already recorded
   upstream), acceptance criteria, and explicit `dev_request_instructions`.
3. Point every package path at durable run artifacts under this workflow run so a
   later `dev` request can cite them without hunting.
4. Instruct the operator to start `./bin/pan init --workflow dev --request ...`
   with a request that references those paths and preserves the design acceptance
   criteria for implementation.

## Output

Populate `data.design_package` with `summary`, `design_spec_path`, `mocks_index`,
`figma_artifacts`, `acceptance_criteria`, and `dev_request_instructions`. Author the
handoff brief as the invocation's schema-valid brief JSON and reference the rendered
HTML first and the brief JSON second.

## Done when

The package is complete, paths are stable, and composition instructions for the
corresponding `dev` run are clear for operator ratification.
