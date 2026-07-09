"""Evidence Note Annotator backend package.

Modules:
    config       paths, constants, section labels
    utils        json io, timestamps
    dsl          field-path DSL <-> JSON-pointer resolution
    schema       schema loading + instantiation of null slots
    evidence     source evidence blocks (left panel)
    slots        the annotation-unit model (every JSON leaf, incl. nulls)
    annotations  reviewer state persistence + progress
    metrics      null-aware precision / recall / F1
    export       downstream bundle builder
    assistant    Claude-backed help assistant
    manual       user-manual markdown provider
    server       FastAPI app + routes
"""
