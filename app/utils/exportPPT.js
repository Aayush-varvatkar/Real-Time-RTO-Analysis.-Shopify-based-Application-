export async function exportDashboardToPPT() {
  // 1. Dynamic imports to prevent SSR (Server-Side Rendering) build errors
  const html2canvas = (await import("html2canvas")).default;
  const pptxgen = (await import("pptxgenjs")).default;
  
  // 2. Initialize PowerPoint Presentation
  const pres = new pptxgen();
  
  // Slide settings (Default 16:9 aspect ratio is 10 x 5.625 inches)
  const slideW = 10;
  const slideH = 5.625;
  const marginX = 0.5;
  const maxContentW = slideW - (marginX * 2); // 9.0 inches
  const maxContentH = 4.3; // Leaves 0.8 inches for header & 0.5 inches margin at bottom
  
  // Helper: Adds a premium professional header to the slide
  function addSlideHeader(slide, title) {
    // Top border accent colored line (Indigo)
    slide.addShape(pres.ShapeType.rect, {
      x: 0,
      y: 0,
      w: slideW,
      h: 0.1,
      fill: { color: "4F46E5" }
    });

    // Slide title text
    slide.addText(title, {
      x: marginX,
      y: 0.25,
      w: maxContentW,
      h: 0.4,
      fontSize: 18,
      bold: true,
      color: "1F2937",
      fontFace: "Arial"
    });

    // Sub-title divider line
    slide.addShape(pres.ShapeType.line, {
      x: marginX,
      y: 0.65,
      w: maxContentW,
      h: 0.01,
      line: { color: "E5E7EB", width: 1 }
    });
  }

  // Helper: Captures a DOM node by CSS selector and centers it on a slide
  async function captureAndAddSlide(selector, title) {
    const el = document.querySelector(selector);
    if (!el) {
      console.warn(`[PPT-Export] Element not found: ${selector}`);
      return;
    }

    try {
      // Capture element to canvas
      const canvas = await html2canvas(el, {
        scale: 2, // Enhances chart & text crispness on screens and when zoomed
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false
      });

      const imgData = canvas.toDataURL("image/png");
      const slide = pres.addSlide();
      
      // Setup slide header
      addSlideHeader(slide, title);

      // Fit captured image onto the 16:9 canvas maintaining the original aspect ratio
      let w = maxContentW;
      let h = (canvas.height / canvas.width) * w;

      if (h > maxContentH) {
        h = maxContentH;
        w = (canvas.width / canvas.height) * h;
      }

      // Center horizontally and vertically within the content area
      const x = marginX + (maxContentW - w) / 2;
      const y = 0.8 + (maxContentH - h) / 2;

      slide.addImage({
        data: imgData,
        x: x,
        y: y,
        w: w,
        h: h
      });

      // Bottom footer metadata
      const dateStr = new Date().toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
      slide.addText(`Store Performance Report | Generated: ${dateStr}`, {
        x: marginX,
        y: slideH - 0.35,
        w: maxContentW,
        h: 0.2,
        fontSize: 8.5,
        color: "9CA3AF",
        fontFace: "Arial"
      });
    } catch (err) {
      console.error(`[PPT-Export] Error capturing section "${title}":`, err);
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // SLIDE 1: Premium Dark-Mode Cover Slide
  // ────────────────────────────────────────────────────────────────────────
  const coverSlide = pres.addSlide();
  
  // Solid Dark Background
  coverSlide.addShape(pres.ShapeType.rect, {
    x: 0,
    y: 0,
    w: slideW,
    h: slideH,
    fill: { color: "111827" }
  });

  // Top header color accent bar
  coverSlide.addShape(pres.ShapeType.rect, {
    x: 0,
    y: 0,
    w: slideW,
    h: 0.15,
    fill: { color: "4F46E5" }
  });

  // Main Report Title
  coverSlide.addText("STORE PERFORMANCE REPORT", {
    x: 1.0,
    y: 1.8,
    w: 8.0,
    h: 0.6,
    fontSize: 30,
    bold: true,
    color: "FFFFFF",
    fontFace: "Arial"
  });

  // Subtitle
  coverSlide.addText("E-Commerce & Logistics Dashboard Analytics", {
    x: 1.0,
    y: 2.5,
    w: 8.0,
    h: 0.4,
    fontSize: 15,
    color: "9CA3AF",
    fontFace: "Arial"
  });

  // Horizontal separating line (Indigo)
  coverSlide.addShape(pres.ShapeType.line, {
    x: 1.0,
    y: 3.1,
    w: 3.0,
    h: 0.01,
    line: { color: "4F46E5", width: 3 }
  });

  // Cover Metadata
  const reportDate = new Date().toLocaleDateString("en-IN", {
    day: "numeric",
    month: "long",
    year: "numeric"
  });
  coverSlide.addText(`Date: ${reportDate}\nPlatform: Shopify Dashboard Client Export`, {
    x: 1.0,
    y: 3.4,
    w: 8.0,
    h: 0.8,
    fontSize: 12,
    color: "D1D5DB",
    lineSpacing: 18,
    fontFace: "Arial"
  });

  // ────────────────────────────────────────────────────────────────────────
  // SLIDES 2-8: Dynamic Content Capture Slides
  // ────────────────────────────────────────────────────────────────────────
  const sections = [
    { selector: "#dashboard-overview", title: "Key Metrics & Revenue Overview" },
    { selector: "#dashboard-history", title: "Order Volume & Delivery Status History" },
    { selector: "#dashboard-tracking", title: "Tracking status & Connector Orders" },
    { selector: "#dashboard-product-rto", title: "Product RTO Performance Breakdown" },
    { selector: "#dashboard-product-revenue", title: "Product Revenue Contribution" },
    { selector: "#dashboard-rto-breakdown", title: "RTO breakdown: Couriers, States, Cities, & Pincodes" },
    { selector: "#dashboard-india-map", title: "Geographical RTO Distribution Map (India)" }
  ];

  for (const section of sections) {
    await captureAndAddSlide(section.selector, section.title);
  }

  // ────────────────────────────────────────────────────────────────────────
  // WRITE FILE TO CLIENT
  // ────────────────────────────────────────────────────────────────────────
  const fileDate = new Date().toISOString().slice(0, 10);
  await pres.writeFile({ fileName: `Store_Performance_Report_${fileDate}.pptx` });
}
