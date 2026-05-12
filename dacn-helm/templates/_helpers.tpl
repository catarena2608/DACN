{{/*
Expand the name of the chart.
*/}}
{{- define "dacn.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
We truncate at 63 chars because some Kubernetes name fields are limited to this (by the DNS naming spec).
If release name contains chart name it will be used as a full name.
*/}}
{{- define "dacn.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "dacn.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "dacn.labels" -}}
helm.sh/chart: {{ include "dacn.chart" . }}
{{ include "dacn.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "dacn.selectorLabels" -}}
app.kubernetes.io/name: {{ include "dacn.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Service labels
*/}}
{{- define "dacn.serviceLabels" -}}
{{- $serviceName := index . 0 -}}
{{- $context := index . 1 -}}
app.kubernetes.io/name: {{ include "dacn.name" $context }}-{{ $serviceName }}
app.kubernetes.io/instance: {{ $context.Release.Name }}
{{- end }}

{{/*
Service selector labels
*/}}
{{- define "dacn.serviceSelectorLabels" -}}
{{- $serviceName := index . 0 -}}
{{- $context := index . 1 -}}
app.kubernetes.io/name: {{ include "dacn.name" $context }}-{{ $serviceName }}
app.kubernetes.io/instance: {{ $context.Release.Name }}
{{- end }}
