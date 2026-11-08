"""Compile one Sigma event rule through the official Splunk backend."""

import logging
import re
import threading

import yaml
from rest_framework.exceptions import ValidationError

from .models import LocalDetectionFieldMapping
from .sigma import _mapping_candidates, _normalize_yaml_for_pysigma

_COMPILER_LOCK = threading.Lock()
logger = logging.getLogger(__name__)
_COMPILATION_HINTS = {
    'SigmaTitleError': 'Provide a non-empty title in the complete Sigma rule.',
    'SigmaLogsourceError': 'Provide a valid logsource mapping with product, service, or category.',
    'SigmaConditionError': 'Check detection.condition syntax and its referenced selection names.',
    'SigmaDetectionError': 'Check detection selections and their value types.',
    'SigmaModifierError': 'Check detection field modifiers supported by the Sigma compiler.',
    'SigmaTypeError': 'Check Sigma metadata and detection value types.',
    'SigmaLevelError': 'Use a valid Sigma level: informational, low, medium, high, or critical.',
    'SigmaStatusError': 'Use a valid Sigma status: stable, test, experimental, deprecated, or unsupported.',
    'SigmaTagError': 'Check Sigma tags; each tag must use the namespace.name format.',
    'SigmaFeatureNotSupportedByBackendError': 'This Sigma feature is not supported by the Splunk backend.',
    'SigmaConfigurationError': 'Check the Splunk field mappings and processing pipeline configuration.',
    'SigmaTransformationError': 'Check the Splunk field mappings and processing pipeline transformations.',
}


def compile_splunk(yaml_text, *, index=None, sourcetype=''):
    try:
        documents = list(yaml.safe_load_all(yaml_text))
    except yaml.YAMLError as exc:
        raise ValidationError('Invalid Sigma YAML.') from exc
    if (len(documents) != 1 or not isinstance(documents[0], dict)
            or 'correlation' in documents[0] or not isinstance(documents[0].get('detection'), dict)):
        raise ValidationError('Splunk publishing currently supports one Sigma event rule, not correlation or multi-document rules.')
    candidates = _mapping_candidates(documents[0])
    rows = LocalDetectionFieldMapping.objects.filter(mapping_profile__in=candidates).order_by('id')
    by_profile = {}
    for row in rows:
        if row.splunk_field:
            if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_.]*', row.splunk_field):
                raise ValidationError('A Splunk field mapping contains an unsupported field name.')
            by_profile.setdefault(row.mapping_profile, {})[row.sigma_field] = row.splunk_field
    mapping = {}
    for profile in candidates:
        for source, destination in by_profile.get(profile, {}).items():
            mapping.setdefault(source, destination)
    stage = 'loading compiler dependencies'
    try:
        from sigma.backends.splunk import SplunkBackend
        from sigma.collection import SigmaCollection
        from sigma.processing.pipeline import ProcessingItem, ProcessingPipeline
        from sigma.processing.transformations import AddConditionTransformation, FieldMappingTransformation

        def render(scope=None):
            nonlocal stage
            stage = 'parsing the Sigma rule'
            collection = SigmaCollection.from_yaml(_normalize_yaml_for_pysigma(yaml_text))
            stage = 'converting the scoped rule to SPL' if scope else 'converting the rule to SPL'
            items = [ProcessingItem(transformation=FieldMappingTransformation(mapping=mapping))] if mapping else []
            if scope:
                items.append(ProcessingItem(transformation=AddConditionTransformation(conditions=scope)))
            # Splunk backend 2.x maintains class-level deferred-regex conversion state.
            with _COMPILER_LOCK:
                return SplunkBackend(processing_pipeline=ProcessingPipeline(name='Argus Splunk mappings', items=items)).convert(
                    collection,
                )

        queries = render()
        if (not isinstance(queries, list) or len(queries) != 1 or not str(queries[0]).strip()
                or str(queries[0]).strip().strip('()" ') == '*'):
            raise ValidationError('The rule must compile to one non-empty, non-match-all SPL query.')
        if index:
            scope = {'index': index, **({'sourcetype': sourcetype} if sourcetype else {})}
            queries = render(scope)
    except ValidationError:
        raise
    except ImportError as exc:
        raise ValidationError('Splunk compiler unavailable. Install the backend requirements.') from exc
    except Exception as exc:
        error_type = type(exc).__name__
        # Compiler exception messages can contain complete rules and detection values.
        logger.warning('Splunk compilation failed: stage=%s error_type=%s', stage, error_type)
        hint = _COMPILATION_HINTS.get(error_type, 'Check the rule, field mappings, and installed backend requirements.')
        raise ValidationError(f'Splunk compilation failed while {stage} ({error_type}). {hint}') from exc
    if not isinstance(queries, list) or len(queries) != 1 or not str(queries[0]).strip():
        raise ValidationError('The rule must compile to exactly one non-empty SPL query.')
    query = str(queries[0]).strip()
    if query == '*':
        raise ValidationError('An unrestricted match-all query cannot be published.')
    return {'language': 'splunk', 'splunk': query, 'profiles': candidates}
