name: Feature request
description: A provider, service, region or output improvement
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What should the tool do that it doesn't?
    validations:
      required: true
  - type: dropdown
    id: kind
    attributes:
      label: Kind of request
      options:
        - New provider
        - New region
        - New service / line item
        - Output / JSON format
        - Pricing model (tiered, reserved, commitments)
        - Other
  - type: textarea
    id: source
    attributes:
      label: Is there an official public pricing API for it?
      description: This tool only uses official pricing sources; links to the API docs are the fastest path to implementation.
