use serde_json::{Value, json};

fn number(row: &Value, field: &str) -> f64 {
    row[field].as_f64().unwrap_or(0.0)
}
fn rate(numerator: f64, denominator: f64) -> Option<f64> {
    (denominator > 0.0).then(|| 100.0 * numerator / denominator)
}
fn round(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

pub fn score(mut row: Value) -> Value {
    let compliance = rate(number(&row, "flagged"), number(&row, "compliance_checks"));
    let hospital = rate(number(&row, "long_stays"), number(&row, "measured"));
    let staffing = rate(number(&row, "staffing_vacancies"), number(&row, "target"))
        .map(|v| (v / 30.0 * 100.0).min(100.0));
    let parts = [
        ("compliance", 0.4, compliance),
        ("hospital", 0.3, hospital),
        ("staffing", 0.3, staffing),
    ];
    let weight: f64 = parts.iter().filter(|p| p.2.is_some()).map(|p| p.1).sum();
    let overall = (weight > 0.0)
        .then(|| round(parts.iter().map(|p| p.1 * p.2.unwrap_or(0.0)).sum::<f64>() / weight));
    row["compliance_risk_pct"] = json!(compliance.map(round));
    row["hospital_risk_pct"] = json!(hospital.map(round));
    row["staffing_risk_pct"] = json!(staffing.map(round));
    row["risk_pct"] = json!(overall);
    row["risk_coverage"] = json!(parts.iter().filter(|p| p.2.is_some()).count());
    row["explanation"] = json!({
        "method": "demo-v1", "note": "Demonstration index, not a validated clinical prediction.",
        "components": parts.iter().map(|(name, base, score)| json!({
            "name": name, "score": score.map(round), "base_weight": base,
            "effective_weight": if score.is_some() { base / weight } else { 0.0 },
            "contribution": score.map(|v| round(base * v / weight))
        })).collect::<Vec<_>>(),
        "flagged_checks": row["flagged"], "measured_stays": row["measured"],
        "long_stays": row["long_stays"], "staffing_target": row["target"]
    });
    for key in ["flagged", "measured", "long_stays", "target"] {
        row.as_object_mut().unwrap().remove(key);
    }
    row
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_data_is_not_zero_risk() {
        let result = score(json!({}));
        assert!(result["risk_pct"].is_null());
        assert_eq!(result["risk_coverage"], 0);
    }
    #[test]
    fn partial_scores_renormalize_weights() {
        let result = score(json!({"compliance_checks": 4, "flagged": 1}));
        assert_eq!(result["risk_pct"], 25.0);
        assert_eq!(result["risk_coverage"], 1);
    }
    #[test]
    fn weighted_score_and_staffing_cap() {
        let result = score(json!({"compliance_checks": 2, "flagged": 1,
            "measured": 4, "long_stays": 1, "target": 10, "staffing_vacancies": 6}));
        assert_eq!(result["risk_pct"], 57.5);
        assert_eq!(result["staffing_risk_pct"], 100.0);
    }
}
