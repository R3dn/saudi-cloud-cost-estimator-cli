name: Bug report
description: Something is wrong (wrong price, crash, bad output)
labels: [bug]
body:
  - type: textarea
    id: what
    attributes:
      label: What happened?
      description: Include the exact command and the output (or error).
    validations:
      required: true
  - type: textarea
    id: expect
    attributes:
      label: What did you expect?
    validations:
      required: true
  - type: dropdown
    id: provider
    attributes:
      label: Provider
      options: [OCI, AWS, Azure, GCP, FX, CLI/other, N/A]
    validations:
      required: true
  - type: textarea
    id: source
    attributes:
      label: If a price looks wrong, what does the provider's own pricing page show?
      description: A link or screenshot of the official price helps a lot — this tool must match official sources.
  - type: input
    id: version
    attributes:
      label: CLI version
      placeholder: output of `saudi-cloud-costs --version`
    validations:
      required: true
