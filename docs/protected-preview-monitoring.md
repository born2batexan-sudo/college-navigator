# Protected-preview monitoring activation

This documentation-only change triggers a fresh protected-branch deployment after the source-monitor environment controls were added.

Safety conditions:
- preview branch only;
- dedicated monitor credential;
- monitoring pipeline explicitly enabled;
- family delivery explicitly disabled;
- model use disabled by the workflow;
- production and `main` unchanged.
