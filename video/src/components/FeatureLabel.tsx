import React from "react";
import { COLORS, FONTS } from "../theme";

interface FeatureLabelProps {
  title: string;
  subtitle?: string;
  align?: "left" | "center";
}

export const FeatureLabel: React.FC<FeatureLabelProps> = ({
  title,
  subtitle,
  align = "center",
}) => {
  return (
    <div style={{ textAlign: align }}>
      <h2
        style={{
          fontFamily: FONTS.body,
          fontSize: 42,
          fontWeight: 700,
          color: COLORS.text,
          margin: 0,
          lineHeight: 1.2,
          letterSpacing: "-0.02em",
        }}
      >
        {title}
      </h2>
      {subtitle && (
        <p
          style={{
            fontFamily: FONTS.body,
            fontSize: 22,
            color: COLORS.textMuted,
            margin: "12px 0 0",
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </p>
      )}
    </div>
  );
};
