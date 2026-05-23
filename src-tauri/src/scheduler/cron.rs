use chrono::{DateTime, Datelike, Duration, Timelike, Utc};

/// Parse a 5-field cron expression and return the next fire time after `after`.
/// Fields: minute hour day-of-month month day-of-week
/// Supports: *, N, N-M, N/M, N,M
pub fn next_cron_time(expr: &str, after: DateTime<Utc>) -> Option<DateTime<Utc>> {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return None;
    }

    let minutes = parse_field(fields[0], 0, 59)?;
    let hours = parse_field(fields[1], 0, 23)?;
    let days = parse_field(fields[2], 1, 31)?;
    let months = parse_field(fields[3], 1, 12)?;
    let weekdays = parse_field(fields[4], 0, 6)?;

    // Start from the next minute
    let mut t = after + Duration::minutes(1);
    t = t
        .with_second(0)
        .unwrap_or(t)
        .with_nanosecond(0)
        .unwrap_or(t);

    // Search up to 2 years ahead to avoid infinite loops
    let limit = after + Duration::days(365 * 2);

    while t < limit {
        if minutes.contains(&t.minute())
            && hours.contains(&t.hour())
            && days.contains(&t.day())
            && months.contains(&t.month())
            && weekdays.contains(&(t.weekday().num_days_from_sunday()))
        {
            return Some(t);
        }
        t += Duration::minutes(1);
    }

    None
}

/// Validate a 5-field cron expression.
pub fn validate_cron(expr: &str) -> bool {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return false;
    }
    let ranges = [(0, 59), (0, 23), (1, 31), (1, 12), (0, 6)];
    fields
        .iter()
        .zip(ranges.iter())
        .all(|(f, &(min, max))| parse_field(f, min, max).is_some())
}

/// Format a time from hour and minute values.
fn format_time(h: u32, m: u32) -> String {
    let period = if h >= 12 { "PM" } else { "AM" };
    let display_h = if h > 12 {
        h - 12
    } else if h == 0 {
        12
    } else {
        h
    };
    format!("{}:{:02} {}", display_h, m, period)
}

/// Format weekday numbers into names.
fn format_weekdays(weekday: &str) -> Vec<String> {
    let day_names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    weekday
        .split(',')
        .filter_map(|d| {
            d.parse::<usize>()
                .ok()
                .and_then(|i| day_names.get(i).map(|s| s.to_string()))
        })
        .collect()
}

/// Generate a human-readable description of a cron expression.
pub fn describe_cron(expr: &str) -> String {
    let fields: Vec<&str> = expr.split_whitespace().collect();
    if fields.len() != 5 {
        return format!("Invalid: {}", expr);
    }

    let (minute, hour, day, month, weekday) =
        (fields[0], fields[1], fields[2], fields[3], fields[4]);

    if expr == "* * * * *" {
        return "Every minute".into();
    }
    if let Some(m) = minute.strip_prefix("*/") {
        return format!("Every {} minutes", m);
    }
    if let Some(h) = hour.strip_prefix("*/") {
        return format!("Every {} hours", h);
    }

    // Single specific time
    if minute != "*" && hour != "*" {
        if let (Ok(h), Ok(m)) = (hour.parse::<u32>(), minute.parse::<u32>()) {
            let time_str = format_time(h, m);

            if weekday != "*" {
                let day_list = format_weekdays(weekday);
                if !day_list.is_empty() {
                    return format!("Every {} at {}", day_list.join(", "), time_str);
                }
            }
            if day == "*" && month == "*" {
                return format!("Every day at {}", time_str);
            }
            return format!("At {}", time_str);
        }

        // Comma-separated minutes with single hour: "15,45 8 * * 1"
        if minute.contains(',') && !hour.contains(',') {
            if let Ok(h) = hour.parse::<u32>() {
                let mins: Vec<String> = minute
                    .split(',')
                    .filter_map(|m| m.parse::<u32>().ok())
                    .map(|m| format!("{:02}", m))
                    .collect();
                if !mins.is_empty() {
                    let period = if h >= 12 { "PM" } else { "AM" };
                    let display_h = if h > 12 {
                        h - 12
                    } else if h == 0 {
                        12
                    } else {
                        h
                    };
                    let times: Vec<String> = mins
                        .iter()
                        .map(|m| format!("{}:{} {}", display_h, m, period))
                        .collect();
                    let prefix = if weekday != "*" {
                        let day_list = format_weekdays(weekday);
                        format!("Every {} at ", day_list.join(", "))
                    } else {
                        "At ".to_string()
                    };
                    return format!("{}{}", prefix, times.join(" and "));
                }
            }
        }
    }

    format!("Schedule: {}", expr)
}

/// Parse a single cron field into a set of valid values.
fn parse_field(field: &str, min: u32, max: u32) -> Option<Vec<u32>> {
    let mut values = Vec::new();

    for part in field.split(',') {
        if part == "*" {
            for v in min..=max {
                values.push(v);
            }
            continue;
        }

        // Handle step: */N or range/step: N-M/S
        if let Some((range, step_str)) = part.split_once('/') {
            let step: u32 = step_str.parse().ok()?;
            if step == 0 {
                return None;
            }
            let (r_min, r_max) = if range == "*" {
                (min, max)
            } else if let Some((a, b)) = range.split_once('-') {
                (a.parse().ok()?, b.parse().ok()?)
            } else {
                let v: u32 = range.parse().ok()?;
                (v, v)
            };
            let mut v = r_min;
            while v <= r_max {
                values.push(v);
                v += step;
            }
            continue;
        }

        // Handle range: N-M
        if let Some((a, b)) = part.split_once('-') {
            let start: u32 = a.parse().ok()?;
            let end: u32 = b.parse().ok()?;
            for v in start..=end {
                values.push(v);
            }
            continue;
        }

        // Single value
        let v: u32 = part.parse().ok()?;
        if v < min || v > max {
            return None;
        }
        values.push(v);
    }

    values.sort();
    values.dedup();
    Some(values)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    #[test]
    fn test_every_minute() {
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 12, 0, 0).unwrap();
        let next = next_cron_time("* * * * *", after).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2025, 1, 1, 12, 1, 0).unwrap());
    }

    #[test]
    fn test_specific_time() {
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 8, 0, 0).unwrap();
        let next = next_cron_time("0 9 * * *", after).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2025, 1, 1, 9, 0, 0).unwrap());
    }

    #[test]
    fn test_step() {
        let after = Utc.with_ymd_and_hms(2025, 1, 1, 12, 0, 0).unwrap();
        let next = next_cron_time("*/15 * * * *", after).unwrap();
        assert_eq!(next, Utc.with_ymd_and_hms(2025, 1, 1, 12, 15, 0).unwrap());
    }

    #[test]
    fn test_validate() {
        assert!(validate_cron("0 9 * * 1-5"));
        assert!(validate_cron("*/5 * * * *"));
        assert!(!validate_cron("invalid"));
        assert!(!validate_cron("60 * * * *"));
    }

    #[test]
    fn test_describe_every_minute() {
        assert_eq!(describe_cron("* * * * *"), "Every minute");
    }

    #[test]
    fn test_describe_every_n_minutes() {
        assert_eq!(describe_cron("*/15 * * * *"), "Every 15 minutes");
    }

    #[test]
    fn test_describe_every_n_hours() {
        assert_eq!(describe_cron("0 */2 * * *"), "Every 2 hours");
    }

    #[test]
    fn test_describe_specific_time_every_day() {
        assert_eq!(describe_cron("0 9 * * *"), "Every day at 9:00 AM");
    }

    #[test]
    fn test_describe_specific_time_weekday() {
        assert_eq!(
            describe_cron("30 8 * * 1,3,5"),
            "Every Mon, Wed, Fri at 8:30 AM"
        );
    }

    #[test]
    fn test_describe_specific_time_single_weekday() {
        assert_eq!(describe_cron("0 9 * * 1"), "Every Mon at 9:00 AM");
    }

    #[test]
    fn test_describe_comma_minutes_with_weekday() {
        assert_eq!(
            describe_cron("15,45 8 * * 1"),
            "Every Mon at 8:15 AM and 8:45 AM"
        );
    }

    #[test]
    fn test_describe_pm_time() {
        assert_eq!(describe_cron("0 14 * * *"), "Every day at 2:00 PM");
    }
}
