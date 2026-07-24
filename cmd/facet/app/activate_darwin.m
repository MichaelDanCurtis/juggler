#import <AppKit/AppKit.h>

void facet_set_dock_icon_visible(int visible) {
    dispatch_async(dispatch_get_main_queue(), ^{
        NSApplicationActivationPolicy policy = visible
            ? NSApplicationActivationPolicyRegular
            : NSApplicationActivationPolicyAccessory;
        [[NSApplication sharedApplication] setActivationPolicy:policy];
    });
}
