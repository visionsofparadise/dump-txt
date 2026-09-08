use super::*;

#[test]
fn restored_windows_keep_the_titlebar_inside_the_work_area() {
    let area = WindowBounds {
        x: 0,
        y: 24,
        width: 1280,
        height: 696,
    };
    assert_eq!(
        fit_bounds(
            WindowBounds {
                x: -600,
                y: -900,
                width: 2400,
                height: 1800
            },
            area
        ),
        area
    );
    assert_eq!(
        fit_bounds(
            WindowBounds {
                x: 1900,
                y: 400,
                width: 960,
                height: 640
            },
            area
        ),
        WindowBounds {
            x: 320,
            y: 80,
            width: 960,
            height: 640
        }
    );
}
